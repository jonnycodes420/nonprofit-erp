import { useState, useEffect, useRef } from "react";
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
  const color = STAGE_COLOR[stage] || "#6b7280";
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

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const GEOCODE_DELAY = 1200;

async function geocode(donor) {
  const parts = [donor.city, donor.state, donor.zip, donor.country].filter(Boolean);
  if (!parts.length) return null;
  const q = parts.join(", ");
  try {
    const res = await fetch(`${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1`, {
      headers: { "Accept-Language": "en", "User-Agent": "Steward-nonprofit-erp" },
    });
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

function MapResizer() {
  const map = useMap();
  useEffect(() => { setTimeout(() => map.invalidateSize(), 100); }, [map]);
  return null;
}

export function DonorMap({ donors, userId, onSelectDonor }) {
  const [coords, setCoords] = useState({});
  const [stageFilters, setStageFilters] = useState(new Set(STAGES.map(s => s.id)));
  const [myOnly, setMyOnly] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const geocodedRef = useRef(new Set());

  const mappable = donors.filter(d => (d.city || d.state || d.zip) && (!myOnly || d.assignedTo === userId));
  const noLocation = donors.filter(d => !d.city && !d.state && !d.zip && (!myOnly || d.assignedTo === userId));

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setGeocoding(true);
      for (const d of mappable) {
        if (geocodedRef.current.has(d.id) || coords[d.id]) continue;
        geocodedRef.current.add(d.id);
        const result = await geocode(d);
        if (!cancelled && result) setCoords(prev => ({ ...prev, [d.id]: result }));
        await new Promise(r => setTimeout(r, GEOCODE_DELAY));
        if (cancelled) break;
      }
      if (!cancelled) setGeocoding(false);
    }
    run();
    return () => { cancelled = true; };
  }, [donors, myOnly]);

  const visibleDonors = mappable.filter(d => coords[d.id] && stageFilters.has(d.stage || "cultivate"));

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
              <input type="checkbox" checked={myOnly} onChange={e => setMyOnly(e.target.checked)} style={{ accentColor: "#3b82f6" }} />
              My portfolio only
            </label>
          </div>
          {geocoding && (
            <div style={{ marginTop: 8, fontSize: 10, color: T.ink3 }}>Geocoding addresses…</div>
          )}
          <div style={{ marginTop: 8, fontSize: 10, color: T.ink3 }}>{visibleDonors.length} mapped · {noLocation.length} no address</div>
        </div>

        {noLocation.length > 0 && (
          <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: 12, overflowY: "auto", flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 8 }}>No address on file</div>
            {noLocation.map(d => (
              <div key={d.id} onClick={() => onSelectDonor(d)} style={{ padding: "6px 0", borderBottom: "1px solid " + T.bg3, cursor: "pointer", fontSize: 12, color: T.greenDk, fontWeight: 500 }}>{d.name}</div>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, borderRadius: 14, overflow: "hidden", border: "1px solid " + T.bg3 }}>
        <MapContainer center={[39.5, -98.35]} zoom={4} style={{ width: "100%", height: "100%" }} scrollWheelZoom={true}>
          <MapResizer />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visibleDonors.map(d => (
            <Marker key={d.id} position={[coords[d.id].lat, coords[d.id].lng]} icon={stageIcon(d.stage || "cultivate")}>
              <Popup>
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>{d.name}</div>
                  {d.city && <div style={{ fontSize: 11, color: "#555" }}>{[d.city, d.state].filter(Boolean).join(", ")}</div>}
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Total: {fmt(d.total)}</div>
                  <div style={{ fontSize: 11, color: STAGE_COLOR[d.stage] || "#6b7280", marginTop: 2, fontWeight: 600, textTransform: "capitalize" }}>{d.stage}</div>
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
