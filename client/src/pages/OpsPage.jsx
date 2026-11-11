// DEVBOARD-1 · /ops: the whole machine on one page (super-admins only; the
// API answers 404 to anyone else). Reads GET /ops once, then every two minutes.
// DEVBOARD-2 · two tabs: the Machine (DEVBOARD-1) and the Map (?tab=map).
// DEVBOARD-3 · two more: the Journey (?tab=journey, how a customer gets
// onboarded) and How it works (?tab=flow, how a gift flows), and a way back to /admin.
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API, apiFetch, getToken } from "../api";
import OpsView from "./ops/OpsView";
import MapView from "./ops/MapView";
import ShipCard from "./ops/ShipCard";
import JourneyView from "./ops/JourneyView";
import FlowView from "./ops/FlowView";
import OnboardingView from "./ops/OnboardingView";   // ONBOARD-2
import ImportCard from "./ops/ImportCard";
import SalesView from "./ops/sales/SalesView";   // SALES-1

const INK = "#0F1A12", CREAM = "#F0EDE6", EMERALD = "#0D5C3A";
const TABS = [["machine", "Machine"], ["sales", "Sales"], ["onboarding", "Onboarding"], ["map", "Map"], ["journey", "Journey"], ["flow", "How it works"]];
const TAB_IDS = TABS.map(t => t[0]);
const NOT_FOR = "This page is for Steward's super-admins.";
// What each tab reads, and what it says when it cannot.
const SOURCES = {
  map: ["/ops/map", "The map could not be read. Try again in a minute."],
  journey: ["/ops/journey", "The journey could not be read. Try again in a minute."],
  flow: ["/ops/flow", "How it works could not be read. Try again in a minute."],
  onboarding: ["/ops/onboarding", "The onboarding board could not be read. Try again in a minute."],   // ONBOARD-2
};

// A Fail's screenshot, read with this session and opened in a new tab.
async function openShot(id) {
  const t = getToken();
  const res = await fetch(`${API}/ops/checks/${encodeURIComponent(id)}/shot`, { credentials: "include", headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function OpsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TAB_IDS.includes(params.get("tab")) ? params.get("tab") : "machine";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [got, setGot] = useState({});        // { map: {data, error}, journey: …, flow: … }

  const load = useCallback(() => apiFetch("/ops")
    .then(d => { setData(d); setError(null); })
    .catch(e => setError(e && e.status === 404 ? NOT_FOR : "The ops summary could not be read. Try again in a minute.")), []);
  const loadTab = useCallback(id => apiFetch(SOURCES[id][0])
    .then(d => setGot(g => ({ ...g, [id]: { data: d, error: null } })))
    .catch(e => setGot(g => ({ ...g, [id]: { data: g[id] && g[id].data, error: e && e.status === 404 ? NOT_FOR : SOURCES[id][1] } }))), []);

  useEffect(() => {
    if (tab === "sales") return undefined;   // SALES-1: the Sales tab reads its own
    const tick = () => (tab === "machine" ? load() : loadTab(tab));
    tick();
    const t = setInterval(tick, 120000);
    return () => clearInterval(t);
  }, [tab, load, loadTab]);

  // The Map opened from How it works lands on its area.
  const mapData = got.map && got.map.data;
  useEffect(() => {
    if (tab !== "map" || !mapData || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
  }, [tab, mapData]);

  const onMark = useCallback(async body => {
    const r = await apiFetch("/ops/checks", { method: "POST", body: JSON.stringify(body) });
    loadTab("map");
    return r;
  }, [loadTab]);

  const tabs = <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${INK}1f`, margin: "0 0 16px" }}>
    <div role="tablist" style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
      {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} data-tab={id}
        onClick={() => setParams(id === "machine" ? {} : { tab: id }, { replace: true })}
        style={{ background: "none", border: 0, borderBottom: `2px solid ${tab === id ? EMERALD : "transparent"}`, padding: "10px 0 8px", minHeight: 40,
          fontSize: 14, fontWeight: tab === id ? 700 : 500, color: INK, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>)}
    </div>
    <span style={{ flex: 1 }} />
    <Link to="/admin" data-back-to-admin="1" style={{ color: EMERALD, fontSize: 13, fontWeight: 600, textDecoration: "none", padding: "10px 0" }}>← Back to admin</Link>
  </div>;

  if (tab === "machine") return <OpsView data={data} error={error} tabs={tabs} onShot={openShot} ship={<ShipCard />} importer={<ImportCard onImported={load} />} />;
  const g = got[tab] || {};
  const wide = tab === "journey" || tab === "flow" || tab === "onboarding" || tab === "sales";
  return <div style={{ background: CREAM, minHeight: "100vh", color: INK, fontFamily: wide ? "'DM Sans', system-ui, sans-serif" : "Inter, system-ui, sans-serif", padding: "24px 16px 64px", boxSizing: "border-box" }}>
    <div style={{ maxWidth: tab === "sales" ? 1400 : wide ? 1180 : 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Ops</h1>
      {tabs}
      {tab === "sales" ? <SalesView />
        : tab === "map" ? <MapView data={g.data || null} error={g.error || null} onMark={onMark} onShot={openShot} />
        : tab === "onboarding" ? <OnboardingView data={g.data || null} error={g.error || null} onReload={() => loadTab("onboarding")} />
        : tab === "journey" ? <JourneyView data={g.data || null} error={g.error || null} />
        : <FlowView data={g.data || null} error={g.error || null} />}
    </div>
  </div>;
}
