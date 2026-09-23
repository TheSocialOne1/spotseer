"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, Rectangle, TileLayer, useMap } from "react-leaflet";

export const TONE_HEX = { green: "#22c55e", amber: "#f59e0b", red: "#ef4444", blue: "#3b82f6" };

// The bottom sheet covers roughly the lower half of the screen, so "center on
// X" means center X in the visible map area above it, not the whole viewport.
function FocusController({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const zoom = focus.zoom ?? Math.max(map.getZoom(), 17);
    const shift = map.getSize().y * 0.22;
    const target = map.unproject(map.project([focus.lat, focus.lng], zoom).add([0, shift]), zoom);
    map.flyTo(target, zoom, { duration: 0.6 });
  }, [focus, map]);
  return null;
}

// Dark basemap on purpose: most painful searches happen at night, and a white
// map is a flashlight in a dark car. Only live, decaying reports are drawn —
// fading opacity *is* the freshness signal.
export default function LiveMap({ zone, events, user, selectedId, onSelect, focus }) {
  const b = zone.bounds;

  return (
    <MapContainer
      center={zone.center}
      zoom={16}
      minZoom={14}
      maxZoom={19}
      zoomControl={false}
      className="h-full w-full"
    >
      {/* Standard OSM tiles darkened in CSS (.leaflet-tile-pane): no API key,
          street names intact. Needs a paid tile provider before real scale. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <FocusController focus={focus} />

      <Rectangle
        bounds={[[b.south, b.west], [b.north, b.east]]}
        pathOptions={{ color: "#64748b", weight: 1, dashArray: "4 6", fill: false, interactive: false }}
      />

      {events
        .filter((e) => e.type === "full")
        .map((e) => (
          <Circle
            key={e.id}
            center={[e.lat, e.lng]}
            radius={70}
            pathOptions={{
              color: TONE_HEX.red,
              weight: 1,
              dashArray: "3 5",
              fillColor: TONE_HEX.red,
              fillOpacity: 0.08 + 0.14 * e.signal.score,
              opacity: 0.3 + 0.5 * e.signal.score,
            }}
            eventHandlers={{ click: () => onSelect(e.id) }}
          />
        ))}

      {events
        .filter((e) => e.type !== "full")
        .map((e) => {
          const color = TONE_HEX[e.tone];
          const selected = e.id === selectedId;
          const opacity = 0.35 + 0.65 * e.signal.score;
          return [
            e.signal.confirmed && (
              <CircleMarker
                key={`${e.id}-halo`}
                center={[e.lat, e.lng]}
                radius={18}
                pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.18 * opacity, interactive: false }}
              />
            ),
            <CircleMarker
              key={e.id}
              center={[e.lat, e.lng]}
              radius={selected ? 12 : 9}
              pathOptions={{
                color: selected ? "#ffffff" : "#0b0f14",
                weight: selected ? 3 : 2,
                fillColor: color,
                fillOpacity: opacity,
              }}
              eventHandlers={{ click: () => onSelect(e.id) }}
            />,
          ];
        })}

      {user && (
        <>
          <Circle
            center={[user.lat, user.lng]}
            radius={Math.min(user.accuracy ?? 0, 150)}
            pathOptions={{ stroke: false, fillColor: TONE_HEX.blue, fillOpacity: 0.12, interactive: false }}
          />
          <CircleMarker
            center={[user.lat, user.lng]}
            radius={7}
            pathOptions={{ color: "#ffffff", weight: 2.5, fillColor: TONE_HEX.blue, fillOpacity: 1, interactive: false }}
          />
        </>
      )}
    </MapContainer>
  );
}
