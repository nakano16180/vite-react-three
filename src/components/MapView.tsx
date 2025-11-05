import { useState } from "react";
import Map from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

interface MapViewProps {
  visible: boolean;
}

// Default map center: Tokyo, Japan
const DEFAULT_LONGITUDE = 139.7671;
const DEFAULT_LATITUDE = 35.6812;
const DEFAULT_ZOOM = 12;

export function MapView({ visible }: MapViewProps) {
  const [viewState, setViewState] = useState({
    longitude: DEFAULT_LONGITUDE,
    latitude: DEFAULT_LATITUDE,
    zoom: DEFAULT_ZOOM,
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
