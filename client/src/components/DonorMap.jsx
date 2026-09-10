import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { T, fmt, STAGES } from "./shared";

// Fix leaflet default icon paths broken by bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const STAGE_COLOR = Object.fromEntries(STAGES.map(s => [s.id, s.color]));

function stageIcon(stage) {
  const color = STAGE_COLOR[stage] || "#6b6560";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.1 13 21 13 21S26 22.1 26 13C26 5.8 20.2 0 13 0z" fill="${color}" opacity="0.9"/>
    <circle cx="13" cy="13" r="5" fill="white" opacity="0.85"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -34],
  });
}

function MapResizer() {
  const map = useMap();
  useEffect(() => { setTimeout(() => map.invalidateSize(), 100); }, [map]);
  return null;
}

// BUILD-84 P0-4 — THE MAP MAKES NO GEOCODER REQUEST.
//
// This component used to call Nominatim from the browser, at render, once per
// donor, 1.2s apart, and keep the answers in component state — so navigating
// away and back started over, a refresh started over, and a 25,000-donor org
// was simply unreachable. Coordinates are donor data now (geocode.js + the
// write-time job in server.js); this reads `latitude`/`longitude` off the row
// and draws.
//
// The other half of the fix is that the map ALWAYS RENDERS and SAYS WHAT IT
// LACKS, in the import receipt's vocabulary. An empty grey rectangle with a
// spinner is the failure mode this build exists to remove: every donor is in
// exactly one of these buckets, and the buckets add up to the donor total.
const STATUS_COPY = {
  ok: "mapped",
  no_address: "no address on file",
  not_found: "could not be located",
  failed: "could not be looked up",
  pending: "still processing",
};

export function DonorMap({ donors, userId, onSelectDonor, apiFetch }) {
  const [stageFilters, setStageFilters] = useState(new Set(STAGES.map(s => s.id)));
  const [myOnly, setMyOnly] = useState(false);
  const [provider, setProvider] = useState(null);

  // One read, for the provider's NAME and whether one is configured at all —
  // never a geocode. The counts below come from the rows already in hand, so
  // they can never disagree with the pins being drawn.
  useEffect(() => {
    if (!apiFetch) return;
    let live = true;
    apiFetch("/geocode/status").then(r => { if (live) setProvider(r); }).catch(() => {});
    return () => { live = false; };
  }, [apiFetch]);

  const mine = useMemo(
    () => donors.filter(d => !myOnly || d.assignedTo === userId || d.assigned_to === userId),
    [donors, myOnly, userId]);

  const buckets = useMemo(() => {
    const b = { ok: [], no_address: [], not_found: [], failed: [], pending: [] };
    for (const d of mine) {
      const lat = d.latitude != null ? Number(d.latitude) : null;
      const lng = d.longitude != null ? Number(d.longitude) : null;
      const placed = Number.isFinite(lat) && Number.isFinite(lng);
      const st = placed ? "ok" : (b[d.geocodeStatus] ? d.geocodeStatus : "pending");
      b[st].push(placed ? { ...d, _lat: lat, _lng: lng } : d);
    }
    return b;
  }, [mine]);

  const visibleDonors = buckets.ok.filter(d => stageFilters.has(d.stage || "cultivate"));
  const unconfigured = provider && provider.provider === "unconfigured";
  // The sentence, in the receipt's shape: every bucket that has anyone in it,
  // named, and the numbers add to the donor total by construction. "Still
  // processing" is only true when something CAN process — with no provider
  // set up, nothing is running, and saying otherwise is exactly the small lie
  // this build exists to remove.
  const line = Object.entries(STATUS_COPY)
    .filter(([k]) => buckets[k].length > 0)
    .map(([k, label]) => `${buckets[k].length.toLocaleString()} ${k === "pending" && unconfigured ? "waiting for a geocoding provider" : label}`)
    .join(" · ") || "no donors in this view";

  const nothingPlaced = buckets.ok.length === 0;

  return (
    <div style={{ display: "flex", gap: 12, height: "calc(100vh - 200px)", minHeight: 400 }}>
      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>Filter by stage</div>
          {STAGES.map(s => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, cursor: "pointer", fontSize: 12, color: T.ink }}>
              <input type="checkbox" checked={stageFilters.has(s.id)} onChange={e => {
                setStageFilters(prev => {
                  const next = new Set(prev);
                  e.target.checked ? next.add(s.id) : next.delete(s.id);
                  return next;
                });
              }} style={{ accentColor: s.color }} />
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block", flexShrink: 0 }} />
              {s.label}
            </label>
          ))}
          <div style={{ borderTop: "1px solid " + T.bg3, marginTop: 8, paddingTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, color: T.ink }}>
              <input type="checkbox" checked={myOnly} onChange={e => setMyOnly(e.target.checked)} style={{ accentColor: "#2f8f62" }} />
              My portfolio only
            </label>
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: T.ink3, lineHeight: 1.6 }}>{line}</div>
        </div>

        {buckets.no_address.length > 0 && (
          <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: 12, overflowY: "auto", flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>No address on file</div>
            {buckets.no_address.slice(0, 200).map(d => (
              <div key={d.id} onClick={() => onSelectDonor(d)} style={{ padding: "6px 0", borderBottom: "1px solid " + T.bg3, cursor: "pointer", fontSize: 12, color: T.greenDk, fontWeight: 500 }}>{d.name}</div>
            ))}
            {buckets.no_address.length > 200 && (
              <div style={{ paddingTop: 6, fontSize: 11, color: T.ink3 }}>…and {(buckets.no_address.length - 200).toLocaleString()} more</div>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, borderRadius: 14, overflow: "hidden", border: "1px solid " + T.bg3, position: "relative" }}>
        {/* Nothing placed is a SENTENCE, not an empty grey rectangle. */}
        {nothingPlaced && (
          <div style={{ position: "absolute", zIndex: 500, left: 12, right: 12, top: 12, background: T.white,
                        border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: T.ink, lineHeight: 1.6 }}>
            {unconfigured
              ? <>No donor is on the map yet because no geocoding provider is set up for Steward. Addresses are never sent anywhere until one is. <span style={{ color: T.ink3 }}>{provider.reason}</span></>
              : buckets.pending.length > 0
                ? <>No donor is on the map yet. {buckets.pending.length.toLocaleString()} {buckets.pending.length === 1 ? "address is" : "addresses are"} still processing — this runs in the background and the pins appear on their own.</>
                : <>No donor is on the map. {line}.</>}
          </div>
        )}
        <MapContainer center={[39.5, -98.35]} zoom={4} style={{ width: "100%", height: "100%" }} scrollWheelZoom={true}>
          <MapResizer />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visibleDonors.map(d => (
            <Marker key={d.id} position={[d._lat, d._lng]} icon={stageIcon(d.stage || "cultivate")}>
              <Popup>
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>{d.name}</div>
                  {d.contactName && <div style={{ fontSize: 11, color: "#6b6560" }}>{d.contactName}</div>}
                  {d.city && <div style={{ fontSize: 11, color: "#6b6560" }}>{[d.city, d.state].filter(Boolean).join(", ")}</div>}
                  <div style={{ fontSize: 11, color: "#6b6560", marginTop: 2 }}>Total: {fmt(d.total ?? d.total_giving)}</div>
                  <div style={{ fontSize: 11, color: STAGE_COLOR[d.stage] || "#6b6560", marginTop: 2, fontWeight: 600, textTransform: "capitalize" }}>{d.stage}</div>
                  <button onClick={() => onSelectDonor(d)} style={{ marginTop: 8, background: "#10b981", border: "none", borderRadius: 6, padding: "5px 10px", color: "#fff", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                    Open profile →
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
