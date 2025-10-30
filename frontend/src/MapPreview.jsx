import React from "react";

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
