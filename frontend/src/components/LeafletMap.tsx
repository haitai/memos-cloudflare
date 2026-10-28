// Kept here rather than in main.tsx so the stylesheet ships with this lazily
// loaded chunk instead of blocking every page view.
import "leaflet/dist/leaflet.css";
import { DivIcon } from "leaflet";
import { MapPinIcon } from "lucide-react";
import { useEffect, useState } from "react";
import ReactDOMServer from "react-dom/server";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";

/**
 * A plain coordinate pair. The component intentionally avoids exporting a
 * Leaflet `LatLng` so that consumers can render it lazily without pulling the
 * whole leaflet runtime into the initial bundle.
 */
export interface LatLngLike {
  lat: number;
  lng: number;
}

const markerIcon = new DivIcon({
  className: "relative border-none",
  html: ReactDOMServer.renderToString(<MapPinIcon className="absolute bottom-1/2 -left-1/2" fill="pink" size={24} />),
});

interface MarkerProps {
  position: LatLngLike | undefined;
  onChange: (position: LatLngLike) => void;
  readonly?: boolean;
}

const LocationMarker = (props: MarkerProps) => {
  const [position, setPosition] = useState(props.position);

  const map = useMapEvents({
    click(e) {
      if (props.readonly) {
        return;
      }

      const next = { lat: e.latlng.lat, lng: e.latlng.lng };
      setPosition(next);
      map.locate();
      // Call the parent onChange function.
      props.onChange(next);
    },
    locationfound() {},
  });

  useEffect(() => {
    map.attributionControl.setPrefix("");
    map.locate();
  }, []);

  return position === undefined ? null : <Marker position={position} icon={markerIcon}></Marker>;
};

interface MapProps {
  readonly?: boolean;
  latlng?: LatLngLike;
  onChange?: (position: LatLngLike) => void;
}

const DEFAULT_CENTER_LAT_LNG: LatLngLike = { lat: 48.8584, lng: 2.2945 };

const LeafletMap = (props: MapProps) => {
  const position = props.latlng || DEFAULT_CENTER_LAT_LNG;
  return (
    <MapContainer className="w-full h-72" center={position} zoom={13} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <LocationMarker position={position} readonly={props.readonly} onChange={props.onChange ? props.onChange : () => {}} />
    </MapContainer>
  );
};

export default LeafletMap;
