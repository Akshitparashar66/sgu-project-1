import { LayerGroup, LayersControl, TileLayer } from "react-leaflet";

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_ATTRIBUTION = "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/**
 * Base map choices, all free and keyless. "Streets" is the default: a full-colour
 * street map reads as a real city; "Satellite" adds aerial imagery with place labels;
 * "Minimal" is a quiet grey map for presenting congestion without distraction.
 */
export function Basemaps() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Streets">
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution={OSM_ATTRIBUTION} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite">
        <LayerGroup>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
            attribution={ESRI_ATTRIBUTION}
          />
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        </LayerGroup>
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Minimal">
        {/* Greyed in globals.css (.aegis-basemap) so the network carries all the colour. */}
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} className="aegis-basemap" attribution={OSM_ATTRIBUTION} />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}
