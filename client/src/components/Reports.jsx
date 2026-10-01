import { MeetingsByStaffCard } from "./MovesPanels";
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, fmtFull, Card, EmptyState, PageTitle, StartHere, LockedFeature, goToPricing, activeMark } from "./shared";
import { ReportTable, ReportRunView, BuilderView } from "./ReportBuilder";
import { errorMessage } from "../lib/domainError";
import { resolveReportId, railGroups, reportLabel, isTabReport, BUILD_ID, PDF_TWIN, filterRail, groupOfReport, collapseKey, isDashboard, dashKeyOf } from "../lib/reportsRail";
import { displayDate } from "../../../shared/displayDate";
import { periodChipLabel } from "../../../shared/fiscalPeriod";
import { Figure, FigureContext } from "./Figure";
import { Dashboards } from "./Dashboards";

// ── Reports (BUILD-02 → FIX-2 B) ────────────────────────────────────────────
// Fixed, parameterized, table-first, CSV-downloadable reports — each one an
// answer to a question a development director or board member actually asks —
// plus the standard reports, the org's saved ones and the builder (BUILD-98).
// All aggregation happens server-side (GET /reports/:key, /saved-reports).
//
// FIX-2 B — ONE WAY IN. The tab row and the "Your reports" list are gone; one
// rail, grouped by the question each report answers, with Build a report at
// its top (client/src/lib/reportsRail.js). Every id a report ever arrived by —
// an old tab id, "std:<key>", a saved report's id — goes through
// resolveReportId, so a Home chip, an Agent link and an email link are one
// mechanism: navigateTo("reports", { report: "lybunt" }).

// BUILD-12: the per-report `q` ("question this answers") strings were removed —
// they rendered as a decorative grey subtitle line that Part 1 cut as clutter.
// These are the reports this file draws itself, with their controls; the rail
// takes their labels from here.
const REPORT_DEFS = [
  { key: "giving-summary", label: "Giving summary" },
  { key: "by-group", label: "Gifts by fund" },
  { key: "lybunt", label: "LYBUNT" },
  { key: "sybunt", label: "SYBUNT" },
  { key: "retention", label: "Retention" },
  { key: "top-donors", label: "Top donors" },
  // BUILD-17 — the development reporting cadence.
  { key: "week-in-review", label: "Week in review" },
  { key: "three-year", label: "3-year comparison" },
  { key: "annual", label: "Annual report" },
  { key: "solicitations", label: "Solicitations", team: true },
  // BUILD-87 Part 4 — the file the person who reconciles the bank actually
  // needs. Fixed columns, one row per gift, and a totals-by-fund section.
  { key: "bookkeeper", label: "Gifts for the bookkeeper" },
];

// Which reports take which controls
const PERIOD_REPORTS = ["giving-summary", "by-group", "top-donors", "bookkeeper"];
// Reports that take a year dropdown + fiscal/calendar toggle (BUILD-17 added
// three-year/annual to the year-selecting family).
const YEAR_SELECT_REPORTS = ["lybunt", "sybunt", "three-year", "annual"];
const YEARMODE_TOGGLE_REPORTS = ["lybunt", "sybunt", "retention", "three-year", "annual", "solicitations"];
const DIGEST_REPORTS = ["week-in-review"]; // fetched from /digests/preview, not /reports/:key

const now = new Date();
const CUR_CY = now.getFullYear();
// FIX-3 E — the fiscal year is the ORG's (its start month comes back on the
// giving summary, from the vocabulary the Board reads), labelled by the year
// it ends in, as the server labels it. July until the server has said.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fyOf = start => (now.getMonth() + 1 < start ? now.getFullYear() : now.getFullYear() + 1);
const fyLastMonth = start => MON[(start + 10) % 12];
const fyRangeLabel = (y, start) => `${MON[start - 1]} ${y - 1} – ${fyLastMonth(start)} ${start === 1 ? y - 1 : y}`;
// FIX-10 Part B — EVERY CHIP SAYS WHICH YEAR IT IS. Reports defaults itself to
// LAST year when the current one is nearly empty, which is kind and was also
// silent: the chip read "Last FY" with no year on it, so the total on screen
// belonged to a year the reader had neither chosen nor been told. The labels
// come from shared/fiscalPeriod.js, the same function the server's
// finPeriodBounds uses for "FY 2026–27", so Reports and Fundraising cannot
// name the same year two ways.
const presetsFor = (fy, fiscalStartMonth = 7) => [
  { id: "thisFY", label: periodChipLabel("thisFY", { fy, cy: CUR_CY, fiscalStartMonth }), year: fy, yearMode: "fiscal" },
  { id: "lastFY", label: periodChipLabel("lastFY", { fy, cy: CUR_CY, fiscalStartMonth }), year: fy - 1, yearMode: "fiscal" },
  { id: "thisCY", label: periodChipLabel("thisCY", { fy, cy: CUR_CY, fiscalStartMonth }), year: CUR_CY, yearMode: "calendar" },
  { id: "lastCY", label: periodChipLabel("lastCY", { fy, cy: CUR_CY, fiscalStartMonth }), year: CUR_CY - 1, yearMode: "calendar" },
  { id: "custom", label: "Custom" },
];
const pctStr = v => v === null || v === undefined ? "—" : `${v}%`;
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// The rail at desktop width; below 760px the list folds into one <select>
// (the compact picker), so nothing on Reports ever scrolls sideways.
const REPORTS_CSS = `
  .reports-layout{display:grid;grid-template-columns:248px minmax(0,1fr);gap:22px;align-items:start;}
  .reports-picker{display:none;}
  .reports-rail-item:hover{background:${T.white};}
  .reports-rail-item:focus-visible,.reports-group-toggle:focus-visible{outline:2px solid ${T.greenDk};outline-offset:1px;}
  .reports-group-toggle:hover{color:${T.ink};}
  @media (max-width:760px){
    .reports-layout{grid-template-columns:minmax(0,1fr);gap:14px;}
    .reports-rail-list{display:none;}
    .reports-rail-list.is-searching{display:block;}
    .reports-picker{display:block;}
  }
`;

// Free visual: % share as a thin brass bar.
function PctBar({ pct }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
    <div style={{ flex: 1, height: 6, background: T.bg2, borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: T.gold, borderRadius: 99 }} />
    </div>
    <span style={{ fontSize: 12, color: T.ink3, minWidth: 42, textAlign: "right" }}>{pct}%</span>
  </div>;
}

// ── THE ONE RAIL ────────────────────────────────────────────────────────────
// Active item (the common brief's rule): white ground, ink, weight 700, and a
// 3px emerald rule on the leading edge — never a solid green block.
//
// FIX-3 E (finding 12): seven groups, each folds under its header; the fold is
// remembered per viewer in this browser (a convenience, so storage that throws
// or comes back empty only means every group starts open). The group holding
// the open report is always opened when the report opens. A search box at the
// top finds a report by name across every group, folded or not; Escape clears
// it. Below 760px the same groups and the same search drive the <select>, and
// while a search is typed its matches are listed under the box as well, so a
// phone can tap one.
const viewerId = () => { try { return (JSON.parse(localStorage.getItem("npe_user") || "{}") || {}).id || null; } catch { return null; } };
const readFolded = key => { try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch { return []; } };
const writeFolded = (key, ids) => { try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* remembered only where the browser lets it be */ } };

function Chevron({ open }) {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
    style={{ flex: "none", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
    <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke={T.ink3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function ReportsRail({ groups, active, activeLabel, onPick }) {
  const [key] = useState(() => collapseKey(viewerId()));
  const openGroup = groupOfReport(active);
  const [folded, setFolded] = useState(() => readFolded(key).filter(g => g !== openGroup));
  const [seenOpen, setSeenOpen] = useState(openGroup);
  const [search, setSearch] = useState("");
  // A report opening inside a folded group opens that group.
  if (openGroup !== seenOpen) {
    setSeenOpen(openGroup);
    if (openGroup && folded.includes(openGroup)) setFolded(folded.filter(g => g !== openGroup));
  }
  useEffect(() => { writeFolded(key, folded); }, [key, folded]);
  const toggle = id => setFolded(f => f.includes(id) ? f.filter(g => g !== id) : [...f, id]);
  const searching = search.trim() !== "";
  const shown = filterRail(groups, search);

  const item = it => {
    const on = active === it.id;
    return <button key={it.id} type="button" className="reports-rail-item" data-testid={`rail-item-${it.id}`} data-report-id={it.id}
      aria-current={on ? "page" : undefined} onClick={() => onPick(it.id)}
      style={{ display: "block", width: "100%", textAlign: "left", background: on ? T.white : "transparent", border: "none",
        borderLeft: `3px solid ${on ? T.greenDk : "transparent"}`, borderRadius: "0 8px 8px 0", padding: "7px 10px",
        color: on ? T.ink : T.ink2, fontWeight: on ? 700 : 500, fontSize: 13, lineHeight: 1.35, cursor: "pointer" }}>
      {it.label}{it.sub ? <span style={{ color: T.ink3, fontWeight: 500 }}> · {it.sub}</span> : null}
    </button>;
  };
  const inPicker = shown.some(g => g.items.some(i => i.id === active));
  // While the builder is open its own Save is the screen's one emerald action,
  // so this button steps down to an outline.
  return <nav data-testid="reports-rail" aria-label="Reports" style={{ minWidth: 0 }}>
    <button type="button" data-testid="rb-new" onClick={() => onPick(BUILD_ID)} aria-current={active === BUILD_ID ? "page" : undefined}
      style={{ width: "100%", background: active === BUILD_ID ? T.white : T.greenDk, color: active === BUILD_ID ? T.greenDk : T.white,
        border: `1.5px solid ${T.greenDk}`, borderRadius: 10, padding: "10px 14px",
        fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>
      Build a report
    </button>
    <input type="text" data-testid="reports-search" className="reports-search" aria-label="Find a report by name" placeholder="Find a report"
      value={search} onChange={e => setSearch(e.target.value)}
      onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setSearch(""); } }}
      style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${T.bg3}`,
        background: T.white, color: T.ink, fontSize: 13, fontFamily: "'DM Sans',sans-serif", marginBottom: 12 }} />
    <select data-testid="reports-picker" className="reports-picker" aria-label="Choose a report" value={active === BUILD_ID ? "" : active}
      onChange={e => e.target.value && onPick(e.target.value)}
      style={{ width: "100%", maxWidth: "100%", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${T.bg3}`, background: T.white,
        color: T.ink, fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" }}>
      {active === BUILD_ID && <option value="">Building a report</option>}
      {active !== BUILD_ID && !inPicker && <option value={active}>{activeLabel || "This report"}</option>}
      {shown.map(g => g.items.length > 0 && <optgroup key={g.id} label={g.question}>
        {g.items.map(it => <option key={it.id} value={it.id}>{it.label}</option>)}
      </optgroup>)}
    </select>
    {searching && shown.length === 0 && <div data-testid="rail-no-match" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, padding: "8px 2px 0" }}>
      No report has &ldquo;{search.trim()}&rdquo; in its name.
    </div>}
    <div data-testid="rail-list" className={`reports-rail-list${searching ? " is-searching" : ""}`}>
      {shown.map(g => {
        const open = searching || !folded.includes(g.id);
        return <div key={g.id} data-testid="rail-group" data-group-id={g.id} style={{ marginBottom: open ? 12 : 4 }}>
          <button type="button" data-testid="rail-group-toggle" className="reports-group-toggle" aria-expanded={open ? "true" : "false"}
            aria-controls={`rail-group-${g.id}`} onClick={() => { if (!searching) toggle(g.id); }}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent",
              border: "none", borderRadius: 8, padding: "6px 10px 6px 13px", margin: "0 0 2px", cursor: searching ? "default" : "pointer",
              fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3, textAlign: "left",
              fontFamily: "'DM Sans',sans-serif" }}>
            <span>{g.question}</span>
            <Chevron open={open} />
          </button>
          {open && <div id={`rail-group-${g.id}`}>
            {g.items.map(item)}
            {g.id === "saved" && g.items.length === 0 && <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, padding: "2px 10px 0 13px" }}>
              Nothing saved yet. Build a report and save it, and it appears here.
            </div>}
          </div>}
        </div>;
      })}
    </div>
  </nav>;
}

// initialReport/initialParams (attribution FIX): the Home hero chips deep-link
// here — "This FY" lands on Giving Summary for the current fiscal year,
// "This week" lands on Giving Summary with a custom from/to matching the
// chip's exact Monday-based week, so the destination shows the SAME number
// the chip claimed. Consumed on mount only (App remounts via navNonce).
export function Reports({ appData, onNavigate, initialReport, initialParams, initialSavedReport }) {
  const [start] = useState(() => resolveReportId(initialSavedReport || initialReport));
  const [active, setActive] = useState(start.id);
  const [list, setList] = useState(null);   // /saved-reports: { standard, saved }
  // NAV-1 §2 — the server's own list of dashboards, so the rail's first group
  // cannot drift from what exists. A failure is silent and the group simply
  // does not appear: Reports is not broken by a dashboard list that would not
  // load.
  const [dashboards, setDashboards] = useState([]);
  const [yearMode, setYearModeState] = useState(() => initialParams?.yearMode || localStorage.getItem("steward_reports_yearmode") || "fiscal");
  const [preset, setPreset] = useState(() => (initialParams?.from && initialParams?.to) ? "custom" : (initialParams?.preset || null)); // null → default per yearMode
  const [customFrom, setCustomFrom] = useState(initialParams?.from || "");
  const [customTo, setCustomTo] = useState(initialParams?.to || "");
  const [year, setYear] = useState(null); // LYBUNT/SYBUNT; null → current per yearMode
  const [groupBy, setGroupBy] = useState(start.params?.groupBy || "funds");
  const [scope, setScope] = useState(start.params?.scope || "period");
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
  const [fiscalStart, setFiscalStart] = useState(null); // the org's first fiscal month; null until the server says

  // The default period resolves from data, not the calendar: early in a new
  // fiscal year "This FY" is nearly empty (e.g. two weeks in), which makes a
  // terrible first impression — so until the current year has real volume
  // (≥10 gifts, or ≥1% of the prior year's dollars), default to Last FY/CY.
  // The user picking any chip overrides this permanently for the session.
  const [autoDefault, setAutoDefault] = useState(null); // null = still resolving

  const setYearMode = v => { localStorage.setItem("steward_reports_yearmode", v); setYearModeState(v); setYear(null); };

  const isTab = isTabReport(active);
  // NAV-1 §2 — a dashboard is neither a tab report, a standard one nor a saved
  // one; it is the Dashboards screen. Declared beside isTab so every branch
  // below reads one word instead of a prefix test.
  const onDashboard = isDashboard(active);
  const fsm = fiscalStart || 7;
  const CUR_FY = fyOf(fsm);
  const PRESETS = presetsFor(CUR_FY, fsm);
  const effPreset = preset || autoDefault;
  const effYear = year || (yearMode === "fiscal" ? CUR_FY : CUR_CY);
  const isPeriodReport = PERIOD_REPORTS.includes(active) && !(active === "top-donors" && scope === "lifetime");
  const showFilters = PERIOD_REPORTS.includes(active) && active !== "bookkeeper" && !(active === "top-donors" && scope === "lifetime");
  const presetPending = (isPeriodReport && !effPreset) || (isTab && fiscalStart === null);

  // Every pick goes through the resolver too: an alias (std:top-50) brings the
  // controls the standard version fixes.
  const pick = id => {
    const r = resolveReportId(id);
    if (r.params?.scope) setScope(r.params.scope);
    if (r.params?.groupBy) setGroupBy(r.params.groupBy);
    setActive(r.id);
  };

  const loadList = () => apiFetch("/saved-reports").then(setList).catch(() => setList({ standard: [], saved: [] }));
  useEffect(() => {
    loadList();
    apiFetch("/dashboards").then(r => setDashboards(r.dashboards || [])).catch(() => {});
    apiFetch("/finance/funds").then(setFunds).catch(() => {});
    apiFetch("/campaigns").then(setCampaigns).catch(() => {});
    const fiscal = yearMode === "fiscal";
    const thisId = fiscal ? "thisFY" : "thisCY", lastId = fiscal ? "lastFY" : "lastCY";
    // No year: the server answers for its current one, in the org's own
    // fiscal year, and says which month that year starts in.
    apiFetch(`/reports/giving-summary?yearMode=${yearMode}`)
      .then(d => {
        setFiscalStart(Number(d.fiscalStartMonth) || 7);
        const lowVolume = d.prior.total > 0 && d.giftCount < 10 && d.total < d.prior.total * 0.01;
        setAutoDefault(lowVolume ? lastId : thisId);
      })
      .catch(() => { setFiscalStart(7); setAutoDefault(thisId); });
  }, []);

  function buildParams() {
    const q = new URLSearchParams();
    // A standard or saved report, or the builder, has no period of its own.
    // It must return BEFORE the period branch: on a first render opened
    // straight onto one (the weekly email's link) the default preset has not
    // resolved yet, and reading `.year` off it took the whole page down
    // (BUILD-98 switch Part 3).
    if (!isTab) return q;
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
    // A standard or saved report (or the builder) fetches its own; nothing here.
    if (!isTab) return;
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
  }, [active, isTab, paramsStr, customIncomplete, presetPending]);

  async function fetchFile(path, name) {
    setDownloading(true);
    try {
      const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Download failed"); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { alert(errorMessage(e, "Download failed")); }
    setDownloading(false);
  }
  function downloadCsv() {
    // Content-Disposition isn't CORS-exposed cross-origin, so build the
    // filename client-side (mirrors the server's naming).
    const suffix = active === "retention" ? yearMode
      : active === "top-donors" && scope === "lifetime" ? "lifetime"
      : YEAR_SELECT_REPORTS.includes(active) ? `${yearMode === "fiscal" ? "fy" : "cy"}${effYear}`
      : active === "solicitations" ? yearMode
      : effPreset === "custom" ? `${customFrom}_${customTo}`
      : effPreset ? effPreset.toLowerCase() : "report";
    return fetchFile(`/reports/${active}?${paramsStr}&format=csv`, `${active}-${suffix}.csv`);
  }
  // The PDF of the standard report that IS this one, offered only while the
  // screen's controls are the ones the standard fixes — the same rows.
  const pdfTwin = PDF_TWIN[active] && (active === "top-donors" ? scope === "lifetime"
    : yearMode === "fiscal" && (active === "retention" || year === null)) ? PDF_TWIN[active] : null;

  // Every person row opens that person, through the app's own navigation.
  const openPerson = id => onNavigate && id && onNavigate("donors", { selectDonorId: id });
  const byId = r => r.id || null;

  // ── Controls ──────────────────────────────────────────────────────────────
  const chipStyle = on => ({ background: T.white, color: T.ink, border: `1.5px solid ${T.bg3}`, borderRadius: 99, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", ...activeMark(on) });
  const selStyle = { padding: "7px 10px", borderRadius: 8, fontSize: 12, fontFamily: "'DM Sans',sans-serif", maxWidth: 180 };
  const segStyle = on => ({ background: T.white, color: T.ink3, border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", ...activeMark(on) });

  const yearModeToggle = <div style={{ display: "flex", border: `1.5px solid ${T.bg3}`, borderRadius: 99, overflow: "hidden" }}>
    {["fiscal", "calendar"].map(m => <button key={m} onClick={() => setYearMode(m)} aria-pressed={yearMode === m} style={segStyle(yearMode === m)}>
      {m === "fiscal" ? `Fiscal (${MON[fsm - 1]}–${fyLastMonth(fsm)})` : "Calendar"}
    </button>)}
  </div>;

  const yearOptions = Array.from({ length: 6 }, (_, i) => (yearMode === "fiscal" ? CUR_FY : CUR_CY) - i);
  const subhead = t => <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3, margin: "22px 0 8px" }}>{t}</div>;

  // ── Narrative + table per report ──────────────────────────────────────────
  let narrative = null, table = null, empty = false;
  const d = data && data.key === active ? data.d : null;

  if (isTab && !loading && !err && d) {
    if (active === "giving-summary") {
      empty = d.giftCount === 0;
      // FIX-3 E (finding 13) — the comparison is the same point last year,
      // the Board's figure through the Board's own source, and the sentence
      // says so. Both figures open onto the gifts that make them.
      const c = d.comparison;
      narrative = <span data-testid="gs-narrative">You've raised <strong><Figure variant="inline" kind="money" value={d.total} figureKey="givingThisPeriod"
          label="Giving this period" definition="Every gift dated in the period you picked." source={d.totalSource} /></strong> from <strong>{d.giftCount} gift{d.giftCount === 1 ? "" : "s"}</strong> this period
        {c && c.value > 0 && <> — {d.total >= c.value ? "up" : "down"} from <Figure variant="inline" kind="money" value={c.value} figureKey="samePointLastYear"
          label={c.label} definition={c.definition} source={c.source} /> at the same point last year</>}.
        {" "}<strong>{d.uniqueDonors}</strong> donor{d.uniqueDonors === 1 ? "" : "s"} gave ({d.newDonors} new, {d.returningDonors} returning); the median gift was <strong>{fmtFull(d.medianGift)}</strong>.</span>;
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
        {/* A month's unique donors do not add up to the period's (one person
            can give in two months), so that column has no foot. */}
        <ReportTable cols={[
          { key: "month", label: "Month", type: "month" },
          { key: "gifts", label: "Gifts", type: "count" },
          { key: "total", label: "Total", type: "money" },
          { key: "donors", label: "Unique donors", type: "number" },
        ]} rows={d.monthly} />
      </>;
    } else if (active === "by-group") {
      empty = d.rows.length === 0;
      const top = d.rows[0];
      narrative = top && <>Your largest {groupBy === "funds" ? "fund" : groupBy === "campaigns" ? "campaign" : "giving page"} this period is <strong>{top.name}</strong> at <strong>{fmtFull(top.total)}</strong> — {top.pct}% of the {fmtFull(d.grandTotal)} raised.</>;
      table = <ReportTable cols={[
        { key: "name", label: groupBy === "funds" ? "Fund" : groupBy === "campaigns" ? "Campaign" : "Giving page", type: "text" },
        { key: "total", label: "Total", type: "money" },
        { key: "giftCount", label: "Gifts", type: "count" },
        { key: "uniqueDonors", label: "Unique donors", type: "number" },
        { key: "pct", label: "% of total", type: "pct", render: r => <PctBar pct={r.pct} /> },
      ]} rows={d.rows} />;
    } else if (active === "lybunt" || active === "sybunt") {
      empty = d.rows.length === 0;
      const atStake = d.rows.reduce((s, r) => s + r.priorYearTotal, 0);
      const yl = yearMode === "fiscal" ? `FY${d.year}` : d.year;
      const priorLabel = yearMode === "fiscal" ? `FY${d.year - 1}` : String(d.year - 1);
      const havent = d.rows.length === 1 ? "hasn't" : "haven't";
      narrative = <><strong>{d.rows.length} donor{d.rows.length === 1 ? "" : "s"}</strong> {active === "lybunt" ? `gave in ${priorLabel} but ${havent} yet given in ${yl}` : `${d.rows.length === 1 ? "has" : "have"} given before, but not in ${yl}`}
        {active === "lybunt" && atStake > 0 && <> — <strong>{fmtFull(atStake)}</strong> of last year's giving is at stake</>}. This is a call list, not a chart.</>;
      table = <ReportTable personOf={byId} onOpen={openPerson} cols={[
        { key: "name", label: "Donor", type: "text", person: true },
        { key: "priorYearTotal", label: active === "lybunt" ? `Gave ${yearMode === "fiscal" ? "FY" + (d.year - 1) : d.year - 1}` : "Gave prior year", type: "money" },
        { key: "lastGiftDate", label: "Last gift", type: "date", render: r => `${displayDate(r.lastGiftDate) || "—"}${r.lastGiftAmount ? ` · ${fmtFull(r.lastGiftAmount)}` : ""}` },
        { key: "lifetimeGiving", label: "Lifetime", type: "money" },
        { key: "assignedTo", label: "Assigned to", type: "text", render: r => r.assignedTo || "—" },
        { key: "email", label: "Email", type: "text", render: r => r.email || "—" },
      ]} rows={d.rows} />;
    } else if (active === "retention") {
      empty = d.rows.every(r => r.priorDonors === 0);
      const latest = [...d.rows].reverse().find(r => r.retentionRate !== null);
      narrative = latest
        ? <>In <strong>{latest.label}</strong> you retained <strong>{latest.retentionRate}%</strong> of the prior year's donors ({latest.retainedDonors} of {latest.priorDonors}) and <strong>{pctStr(latest.dollarRetentionRate)}</strong> of their dollars.{latest.firstYearRetentionRate !== null && <> First-year donors came back at <strong>{latest.firstYearRetentionRate}%</strong> — that number is what stewardship moves.</>}</>
        : <>Not enough multi-year giving history yet to compute retention.</>;
      // Each row is a different year's cohort; they do not add up, so no foot.
      table = <ReportTable foot={false} cols={[
        { key: "label", label: "Year", type: "text" },
        { key: "priorDonors", label: "Prior-yr donors", type: "number" },
        { key: "retainedDonors", label: "Retained", type: "number" },
        { key: "retentionRate", label: "Retention", type: "pct", render: r => <strong style={{ color: T.ink }}>{pctStr(r.retentionRate)}</strong> },
        { key: "dollarRetentionRate", label: "$ retained", type: "pct", render: r => `${pctStr(r.dollarRetentionRate)}${r.priorDollars > 0 ? ` of ${fmtFull(r.priorDollars)}` : ""}` },
        { key: "firstYearDonors", label: "First-yr donors", type: "number" },
        { key: "firstYearRetentionRate", label: "First-yr retention", type: "pct", render: r => <strong style={{ color: r.firstYearRetentionRate !== null && r.firstYearRetentionRate < 30 ? T.gold600 : T.ink }}>{pctStr(r.firstYearRetentionRate)}</strong> },
      ]} rows={d.rows} />;
    } else if (active === "top-donors") {
      empty = d.rows.length === 0;
      const sum = d.rows.reduce((s, r) => s + r.total, 0);
      narrative = d.rows.length > 0 && <>Your top <strong>{d.rows.length}</strong> donors {scope === "lifetime" ? "have given" : "gave"} <strong>{fmtFull(sum)}</strong>{scope === "lifetime" ? " all-time" : " this period"}.</>;
      table = <ReportTable personOf={byId} onOpen={openPerson} cols={[
        { key: "rank", label: "#", type: "number" },
        { key: "name", label: "Donor", type: "text", person: true },
        { key: "total", label: scope === "lifetime" ? "Lifetime giving" : "Total this period", type: "money" },
        { key: "giftCount", label: "Gifts", type: "count" },
        { key: "lastGiftDate", label: "Last gift", type: "date" },
      ]} rows={d.rows} />;
    } else if (active === "three-year") {
      empty = d.years.every(y => y.total === 0);
      const g = d.orgGrowthPct;
      narrative = <>Across the last three years your giving went {d.years.map((y, i) => <span key={y.year}>{i ? " → " : ""}<strong>{fmtFull(y.total)}</strong> ({y.label})</span>)}
        {g !== null && <> — {g >= 0 ? "up" : "down"} <strong>{Math.abs(g)}%</strong> year over year</>}. Each row compares a donor across the three years.</>;
      const chg = r => r.changePct === null ? <span style={{ color: T.gold600, fontWeight: 700 }}>new</span>
        : <span style={{ color: T.ink, fontWeight: 700 }}>{r.changePct > 0 ? "+" : ""}{r.changePct}%</span>;
      table = <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          {d.years.map(y => <div key={y.year} style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "10px 14px", minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>{y.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, marginTop: 2 }}>{fmtFull(y.total)}</div>
            <div style={{ fontSize: 11, color: T.ink3 }}>{y.donors} donor{y.donors === 1 ? "" : "s"}</div>
          </div>)}
        </div>
        <ReportTable personOf={byId} onOpen={openPerson} cols={[
          { key: "name", label: "Donor", type: "text", person: true },
          { key: "y2", label: d.labels.y2, type: "money" },
          { key: "y1", label: d.labels.y1, type: "money" },
          { key: "y0", label: d.labels.y0, type: "money" },
          { key: "changePct", label: "YoY change", type: "pct", render: chg, sortVal: r => r.changePct ?? Infinity },
          { key: "assignedTo", label: "Assigned to", type: "text", render: r => r.assignedTo || "—" },
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
          <div style={{ minWidth: 0 }}>{subhead("By fund")}
            <ReportTable cols={[{ key: "name", label: "Fund", type: "text" }, { key: "total", label: "Total", type: "money" }, { key: "pct", label: "% ", type: "pct", render: r => <PctBar pct={r.pct} /> }]} rows={d.byFund} /></div>
          <div style={{ minWidth: 0 }}>{subhead("By campaign")}
            <ReportTable cols={[{ key: "name", label: "Campaign", type: "text" }, { key: "total", label: "Total", type: "money" }, { key: "pct", label: "% ", type: "pct", render: r => <PctBar pct={r.pct} /> }]} rows={d.byCampaign} /></div>
        </div>
      </>;
    } else if (active === "bookkeeper") {
      empty = d.rows.length === 0;
      narrative = <>{d.giftCount} gift{d.giftCount === 1 ? "" : "s"} between <strong>{displayDate(d.from)}</strong> and <strong>{displayDate(d.to)}</strong>, totalling <strong>{fmtFull(Number(d.total))}</strong>. One row per gift, sorted by date then donor.</>;
      const bkType = c => c.money ? "money" : c.key === "date" ? "date" : "text";
      table = <>
        {/* ONE line, above the button, saying what is deliberately not here. */}
        <div data-testid="bk-exclusion-note" style={{ fontSize: 12.5, color: T.ink3, marginBottom: 14, lineHeight: 1.6 }}>
          Soft credits and matched-gift relationships are left out on purpose: the bookkeeper reconciles money that arrived, and a soft credit is not money. A donor-advised fund grant is money, so it is here under the fund that sent it.
        </div>
        {!d.balanced && <div data-testid="bk-refused" style={{ fontSize: 12.5, color: T.terra700, background: T.terra100, border: `1px solid ${T.terra200}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
          {d.exportRefused}
        </div>}
        {/* The file carries every column as it is; the screen reads it. The
            amount sums from the server's own integer cents. */}
        <ReportTable personOf={r => r.donorId || null} onOpen={openPerson}
          cols={d.columns.map(c => ({ key: c.key, label: c.label, type: bkType(c), person: c.key === "donorName",
            ...(c.money ? { value: r => (Number.isFinite(Number(r.cents)) ? Number(r.cents) / 100 : r[c.key]) } : {}) }))} rows={d.rows} />
        {subhead("Totals by fund")}
        <ReportTable foot={false} cols={[
          { key: "name", label: "Fund or designation", type: "text" },
          { key: "giftCount", label: "Gifts", type: "count" },
          { key: "amount", label: "Amount", type: "money" },
        ]} rows={d.byFund} />
        <div data-testid="bk-fund-total" style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginTop: 10, textAlign: "right" }}>
          Total {fmtFull(Number(d.total))}
        </div>
      </>;
    } else if (active === "solicitations") {
      empty = d.forecast.open === 0 && d.byOfficer.every(o => o.asksMade === 0 && o.giftsClosed === 0);
      narrative = <>You have <strong>{fmtFull(d.forecast.open)}</strong> in open asks; the stage-weighted forecast is <strong>{fmtFull(d.forecast.weighted)}</strong>. Below: asks by stage, activity by officer, and the prospects that have stalled longest.</>;
      table = <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 18 }}>
          {[["Open asks", fmtFull(d.forecast.open)], ["Stage-weighted forecast", fmtFull(d.forecast.weighted)]].map(([l, v]) =>
            <div key={l} style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, marginTop: 2 }}>{v}</div>
            </div>)}
        </div>
        {subhead("Open asks by stage")}
        <ReportTable cols={[
          { key: "stage", label: "Stage", type: "text", render: r => cap(r.stage) },
          { key: "count", label: "Open asks", type: "count" },
          { key: "ask", label: "Ask total", type: "money" },
          { key: "weight", label: "Close prob.", type: "pct", render: r => `${Math.round(r.weight * 100)}%` },
          { key: "weighted", label: "Weighted", type: "money" },
        ]} rows={d.byStage} />
        {subhead("Asks vs. closes by officer")}
        <ReportTable foot={false} cols={[
          { key: "name", label: "Officer", type: "text", render: r => <span style={{ fontWeight: 700, color: T.ink }}>{r.name}</span> },
          { key: "openAsks", label: "Open", type: "number", render: r => `${r.openAsks} · ${fmtFull(r.openAskAmount)}` },
          { key: "asksMade", label: "Made", type: "number", render: r => `${r.asksMade} · ${fmtFull(r.asksMadeAmount)}` },
          { key: "giftsClosed", label: "Won", type: "number", render: r => `${r.giftsClosed} · ${fmtFull(r.giftsClosedAmount)}` },
          { key: "lostAsks", label: "Lost", type: "number", render: r => `${r.lostAsks ?? 0}` },
          { key: "winRate", label: "Win rate", type: "pct", render: r => r.winRate === null
            ? <span title="No decided asks yet" style={{ color: T.ink3 }}>—</span>
            : `${r.winRate}%` },
        ]} rows={d.byOfficer} />
        <div style={{ fontSize: 11, color: T.ink3, marginTop: 6 }}>Win rate = won ÷ (won + lost) — decided asks only. Open asks aren't losses; “—” means no decided asks yet.</div>
        {d.aging.length > 0 && <>
          {subhead("Aging prospects")}
          <ReportTable personOf={byId} onOpen={openPerson} cols={[
            { key: "name", label: "Prospect", type: "text", person: true },
            { key: "stage", label: "Stage", type: "text", render: r => cap(r.stage) },
            { key: "ask", label: "Ask", type: "money" },
            { key: "stageAge", label: "Days in stage", type: "number", render: r => <strong style={{ color: r.stageAge > 60 ? T.gold600 : T.ink }}>{r.stageAge}</strong> },
            { key: "assignedTo", label: "Officer", type: "text", render: r => r.assignedTo || "—" },
          ]} rows={d.aging} />
        </>}
      </>;
    } else if (active === "week-in-review") {
      if (d.type === "monthly") {
        const r = d.report;
        empty = false;
        narrative = <>Your month at a glance — <strong>{r.officerName}</strong>, {displayDate(d.window.start)} to {displayDate(d.window.end)}.</>;
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
        narrative = <><strong>{displayDate(d.window.start)}</strong> to <strong>{displayDate(d.window.end)}</strong>{d.scope === "officer" ? " · your portfolio" : ""} — <strong>{fmtFull(tt.giftTotal)}</strong> in {tt.giftCount} gift{tt.giftCount === 1 ? "" : "s"}, {tt.askCount} ask{tt.askCount === 1 ? "" : "s"}, {tt.moveCount} move{tt.moveCount === 1 ? "" : "s"}, <strong style={{ color: tt.pastDueCount ? T.gold600 : T.ink2 }}>{tt.pastDueCount} past-due task{tt.pastDueCount === 1 ? "" : "s"}</strong>.{d.teamRollup && <> Team-wide this week: {fmtFull(d.teamRollup.giftTotal)} across {d.teamRollup.giftCount} gifts.</>}</>;
        const Section = ({ title, items, empty: e, render }) => <div style={{ marginBottom: 18, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>{title}</div>
          {items.length === 0 ? <div style={{ fontSize: 13, color: T.ink3 }}>{e}</div>
            : <div style={{ border: `1px solid ${T.bg3}`, borderRadius: 10, overflow: "hidden" }}>{items.map((it, i) => <div key={i}
                onClick={it.donorId ? () => openPerson(it.donorId) : undefined} className={it.donorId ? "rpt-row-click" : undefined}
                style={{ padding: "9px 14px", borderTop: i ? `1px solid ${T.bg2}` : "none", display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5, color: T.ink, cursor: it.donorId ? "pointer" : "default" }}>{render(it)}</div>)}</div>}
        </div>;
        table = <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 20 }}>
          <Section title="Gifts received" items={s.gifts} empty="No gifts this week." render={g => <><span>{g.donorName}</span><strong>{fmtFull(g.amount)}</strong></>} />
          <Section title="Asks / pledges made" items={s.asks} empty="No new asks this week." render={a => <><span>{a.donorName}{a.name ? ` — ${a.name}` : ""}</span><strong>{fmtFull(a.targetAmount)}</strong></>} />
          <Section title="Moves" items={s.moves} empty="No pipeline moves this week." render={m => <div style={{ width: "100%" }}><div style={{ fontWeight: 600 }}>{m.donorName} · {m.fromStage || "—"} → {m.toStage}</div><div style={{ fontSize: 12, color: T.ink3 }}>{m.description}</div></div>} />
          <Section title="Past-due tasks" items={s.pastDueTasks} empty="Nothing past due — nice." render={t => <><span>{t.title}{t.donorName ? ` · ${t.donorName}` : ""}</span><span style={{ color: T.gold600, fontSize: 12, whiteSpace: "nowrap" }}>due {displayDate(t.due)}</span></>} />
        </div>;
      }
    }
  }

  const standard = list?.standard || [], saved = list?.saved || [];
  const groups = railGroups(REPORT_DEFS, standard, saved, dashboards);
  const label = reportLabel(active, REPORT_DEFS, standard, saved, dashboards);
  const stdMeta = [...standard, ...saved].find(r => r.id === active) || null;

  return <FigureContext.Provider value={{ openPerson }}><div className="fade-in">
    <style>{REPORTS_CSS}</style>
    <PageTitle main="Your" accent="Reports" />

    {/* First-visit signpost (BUILD-08 Phase D) — shown until "Got it". */}
    <div style={{ marginBottom: 14 }}>
      <StartHere dismissKey="reports_intro"
        line="If you only ever open one report, make it LYBUNT: the people who gave last year and haven't yet this year. It's where retention is won or lost, and every row clicks through to the donor."
        actionLabel="Open LYBUNT" onAction={() => pick("lybunt")} />
    </div>

    {/* INT-BUILD-1 Part 6 — meetings per staff member per month. */}
    <div style={{ marginBottom: 14 }}><MeetingsByStaffCard /></div>

    <div className="reports-layout">
      <ReportsRail groups={groups} active={active} activeLabel={label} onPick={pick} />

      <div style={{ minWidth: 0 }}>
        {active === BUILD_ID && <BuilderView onOpen={openPerson} onCancel={() => pick("")}
          onSaved={id => { loadList().then(() => setActive(id)); }} />}

        {/* NAV-1 §2 — a dashboard, drawn by the component that always drew it.
            It has no rail of its own in here: this rail IS its rail, which is
            the whole point of the fold (FIX-2 B — Reports has ONE way in). */}
        {onDashboard && <Dashboards data={appData} onNavigate={onNavigate} dashKey={dashKeyOf(active)} />}

        {!isTab && !onDashboard && active !== BUILD_ID && <ReportRunView id={active} meta={stdMeta} onOpen={openPerson} />}

        {isTab && <Card style={{ padding: "18px 22px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginBottom: 12 }}>{label}</div>
          {/* Param bar */}
          <div className="reports-parambar" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
            {isPeriodReport && PRESETS.map(p => <button key={p.id} onClick={() => setPreset(p.id)} aria-pressed={effPreset === p.id} style={chipStyle(effPreset === p.id)}>{p.label}</button>)}
            {isPeriodReport && effPreset === "custom" && <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={selStyle} />
              <span style={{ color: T.ink3, fontSize: 12 }}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={selStyle} />
            </>}
            {YEARMODE_TOGGLE_REPORTS.includes(active) && yearModeToggle}
            {YEAR_SELECT_REPORTS.includes(active) && <select value={effYear} onChange={e => setYear(parseInt(e.target.value, 10))} style={{ ...selStyle, maxWidth: 230 }}>
              {yearOptions.map(y => <option key={y} value={y}>{yearMode === "fiscal" ? `FY${y} (${fyRangeLabel(y, fsm)})` : y}</option>)}
            </select>}
            {active === "week-in-review" && <div style={{ display: "flex", border: `1.5px solid ${T.bg3}`, borderRadius: 99, overflow: "hidden" }}>
              {["weekly", "monthly"].map(s => <button key={s} onClick={() => setDigestType(s)} aria-pressed={digestType === s}
                style={{ ...segStyle(digestType === s), textTransform: "capitalize" }}>{s}</button>)}
            </div>}
            {active === "by-group" && <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={selStyle}>
              <option value="funds">By fund</option>
              <option value="campaigns">By campaign</option>
              <option value="giving_pages">By giving page</option>
            </select>}
            {active === "top-donors" && <div style={{ display: "flex", border: `1.5px solid ${T.bg3}`, borderRadius: 99, overflow: "hidden" }}>
              {["period", "lifetime"].map(s => <button key={s} onClick={() => setScope(s)} aria-pressed={scope === s}
                style={{ ...segStyle(scope === s), textTransform: "capitalize" }}>{s}</button>)}
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
            {pdfTwin && <button onClick={() => fetchFile(`/saved-reports/${encodeURIComponent(pdfTwin)}/pdf`, `${label || active}.pdf`)} disabled={downloading || loading}
              style={{ background: T.white, border: `1.5px solid ${T.bg3}`, borderRadius: 10, padding: "7px 16px", color: T.ink, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", opacity: downloading || loading ? 0.6 : 1 }}>
              PDF
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
            Running {label}…
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
              <LockedFeature minHeight={d ? 420 : 300} title={lockMeta.title} blurb={lockMeta.blurb} onCta={goToPricing}>
                {body}
              </LockedFeature>
            );
            return <>{errBlock}{body}</>;
          })()}
        </Card>}
      </div>
    </div>
  </div></FigureContext.Provider>;
}
