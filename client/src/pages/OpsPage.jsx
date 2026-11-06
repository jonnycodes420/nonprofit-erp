// DEVBOARD-1 · /ops: the whole machine on one page (super-admins only; the
// API answers 404 to anyone else). Reads GET /ops once, then every two minutes.
// DEVBOARD-2 · two tabs: the Machine (DEVBOARD-1) and the Map (?tab=map).
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API, apiFetch, getToken } from "../api";
import OpsView from "./ops/OpsView";
import MapView from "./ops/MapView";

const INK = "#0F1A12", CREAM = "#F0EDE6", EMERALD = "#0D5C3A";
const TABS = [["machine", "Machine"], ["map", "Map"]];
const NOT_FOR = "This page is for Steward's super-admins.";

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
  const tab = params.get("tab") === "map" ? "map" : "machine";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [map, setMap] = useState(null);
  const [mapError, setMapError] = useState(null);

  const load = useCallback(() => apiFetch("/ops")
    .then(d => { setData(d); setError(null); })
    .catch(e => setError(e && e.status === 404 ? NOT_FOR : "The ops summary could not be read. Try again in a minute.")), []);
  const loadMap = useCallback(() => apiFetch("/ops/map")
    .then(d => { setMap(d); setMapError(null); })
    .catch(e => setMapError(e && e.status === 404 ? NOT_FOR : "The map could not be read. Try again in a minute.")), []);

  useEffect(() => {
    const tick = () => (tab === "map" ? loadMap() : load());
    tick();
    const t = setInterval(tick, 120000);
    return () => clearInterval(t);
  }, [tab, load, loadMap]);

  const onMark = useCallback(async body => {
    const r = await apiFetch("/ops/checks", { method: "POST", body: JSON.stringify(body) });
    loadMap();
    return r;
  }, [loadMap]);

  const tabs = <div role="tablist" style={{ display: "flex", gap: 18, borderBottom: `1px solid ${INK}1f`, margin: "0 0 16px" }}>
    {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} data-tab={id}
      onClick={() => setParams(id === "map" ? { tab: "map" } : {}, { replace: true })}
      style={{ background: "none", border: 0, borderBottom: `2px solid ${tab === id ? EMERALD : "transparent"}`, padding: "10px 0 8px", minHeight: 40,
        fontSize: 14, fontWeight: tab === id ? 700 : 500, color: INK, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>)}
  </div>;

  if (tab === "machine") return <OpsView data={data} error={error} tabs={tabs} onShot={openShot} />;
  return <div style={{ background: CREAM, minHeight: "100vh", color: INK, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 16px 48px" }}>
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Ops</h1>
      {tabs}
      <MapView data={map} error={mapError} onMark={onMark} onShot={openShot} />
    </div>
  </div>;
}
