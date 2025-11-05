import { useState } from "react";
import Map from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

interface MapViewProps {
  visible: boolean;
}

export function MapView({ visible }: MapViewProps) {
  const [viewState, setViewState] = useState({
    longitude: 139.7671,
    latitude: 35.6812,
    zoom: 12,
  });

  if (!visible) return null;

  return (
    <div style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}>
      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://demotiles.maplibre.org/style.json"
      />
    </div>
  );
}
