// MAP PREVIEW — concise overview
// Small snapshot of the chosen map image. Editing happens in MapEditor.
// this component is used on the LandingPage to show the public map.
// in mapeditor and admin workflows
import React from "react";

// map preview component
// shows either the map image or a placeholder if none is set
// accepts imageUrl prop for the map image source
// uses CSS classes for styling
export default function MapPreview({ imageUrl }) {
  return (
    <div
      className={`map-dropzone ${imageUrl ? "has-image" : ""}`}
      aria-label="Map preview"
      tabIndex={0}
    >
      {!imageUrl && (
        <div className="map-dropzone__helper">
          <div className="map-dropzone__dashes">
            - - - - - - - - - - - - - - - -
          </div>
          <div className="map-dropzone__text">No map set by admin yet</div>
          <div className="map-dropzone__dashes">
            - - - - - - - - - - - - - - - -
          </div>
          <div className="map-dropzone__hint">
            This area will show the public map
          </div>
        </div>
      )}
      {imageUrl && (
        <img className="map-dropzone__img" src={imageUrl} alt="Public map" />
      )}
    </div>
  );
}
