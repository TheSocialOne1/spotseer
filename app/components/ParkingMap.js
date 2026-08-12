"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import { STATUS_STYLES } from "@/lib/statusColors";

const CENTER = [33.767717, -118.180526];

export default function ParkingMap({ spots, selectedId, onSelect }) {
  return (
    <MapContainer
      center={CENTER}
      zoom={18}
      scrollWheelZoom={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {spots.map((spot) => {
        const style = STATUS_STYLES[spot.status.level] ?? STATUS_STYLES.gray;
        const isSelected = spot.id === selectedId;

        return (
          <CircleMarker
            key={spot.id}
            center={[spot.lat, spot.lng]}
            radius={isSelected ? 14 : spot.featured ? 12 : 9}
            pathOptions={{
              color: "#ffffff",
              weight: isSelected ? 3 : 2,
              fillColor: style.hex,
              fillOpacity: 0.95,
            }}
            eventHandlers={{ click: () => onSelect(spot.id) }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              <div className="text-xs font-semibold">{spot.name}</div>
              <div className="text-xs text-zinc-500">{spot.status.label}</div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
