"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";

const CENTER = [33.767717, -118.180526];

function pinIcon(label, featured) {
  const size = featured ? 30 : 24;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      background:#0ea5e9;border:3px solid #ffffff;
      box-shadow:0 1px 4px rgba(0,0,0,0.45);
      display:flex;align-items:center;justify-content:center;
      color:#ffffff;font-size:11px;font-weight:700;font-family:sans-serif;
    ">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function CalibrateMap({ spots, onDragEnd }) {
  return (
    <MapContainer center={CENTER} zoom={19} maxZoom={21} className="h-full w-full">
      <TileLayer
        attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={21}
        maxNativeZoom={19}
      />
      {spots.map((spot, i) => (
        <Marker
          key={spot.id}
          position={[spot.lat, spot.lng]}
          draggable
          icon={pinIcon(i + 1, spot.featured)}
          eventHandlers={{
            dragend: (e) => {
              const { lat, lng } = e.target.getLatLng();
              onDragEnd(spot.id, lat, lng);
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -18]}>
            {spot.name} — {spot.cross}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
