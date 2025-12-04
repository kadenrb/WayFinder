/*
  DebuggerPanel – tiny cockpit for all the sensor chaos:
  - This is your "what the hell is my browser doing right now?" window.
  - It only renders if `visible` is true, so you can keep it wired in
    without spamming the UI all the time.
  - It shows:
      - Raw sensor messages (good for seeing which events are firing).
      - DeviceOrientation heading vs the snapped display heading.
      - Raw compass heading just before any snapping/correction.
      - rotationRate yaw (deg/s) from devicemotion.
      - Acceleration magnitude (with gravity baked in if that’s all we get).
      - Baseline calibration sample count + whether we’re "ready".
      - Recording state + simple status message.
      - Current heading offset (so you can sanity check map ↔ device alignment).
  - Everything is rendered in a simple card with monospace text,
    making it easy to film with your phone while walking around.
*/

import React from "react";

export default function DebuggerPanel({
  visible,
  heading,
  displayHeading,
  compassHeading,
  yaw,
  accelMagnitude,
  baselineSamples,
  baselineReady,
  sensorMsg,
  headingOffset,
  recording,
  recordMsg,
}) {
  // Early-out guard:
  // If we’re not in "debug mode", bail immediately so the rest of the
  // component doesn’t even hit the render tree. Keeps the DOM quiet.
  if (!visible) return null;

  /*
    rows – the debug table model:
    - Each entry is [label, value] and gets rendered as a two-column row.
    - We normalize all the numbers here:
        - Headings → one decimal place + "deg".
        - Yaw → two decimals + "deg/s".
        - Acceleration → three decimals + "g".
    - Null/undefined values become "-" so the UI doesn’t flicker "NaN".
    - Baseline row calls out whether we’re still calibrating or fully "ready".
    - Recording row shows either a custom recordMsg or a sane default.
  */
  const rows = [
    ["Sensor msg", sensorMsg || "-"],
    [
      "DeviceOrientation heading",
      heading != null ? heading.toFixed(1) + " deg" : "-",
    ],
    [
      "Display heading (snapped)",
      displayHeading != null ? displayHeading.toFixed(1) + " deg" : "-",
    ],
    [
      "Compass (raw)",
      compassHeading != null ? compassHeading.toFixed(1) + " deg" : "-",
    ],
    ["rotationRate yaw", yaw != null ? yaw.toFixed(2) + " deg/s" : "-"],
    [
      "accelerationIncludingGravity | acceleration (mag)",
      accelMagnitude != null ? accelMagnitude.toFixed(3) + " g" : "-",
    ],
    [
      "Baseline samples",
      baselineReady
        ? `${baselineSamples} (ready)`
        : `${baselineSamples} (calibrating)`,
    ],
    [
      "Recording",
      recording ? recordMsg || "Recording..." : recordMsg || "Idle",
    ],
    [
      "Heading offset",
      headingOffset != null ? headingOffset.toFixed(1) + " deg" : "-",
    ],
  ];

  /*
    Render – compact debug card:
    - Dark background so it visually reads as a "dev HUD" instead of app chrome.
    - rows.map(...) builds each key/value line with a light border.
    - The little legend at the bottom explains what each metric actually is,
      so future-you (or Jeff, or a marker) can decode it without asking.
  */
  return (
    <div
      className="card shadow-sm mt-3"
      style={{ background: "#101828", color: "#eee" }}
    >
      <div className="card-header py-2 d-flex justify-content-between">
        <strong>Sensor Debugger</strong>
        <span className="text-muted small">Live values</span>
      </div>
      <div
        className="card-body p-2"
        style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
      >
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="d-flex justify-content-between border-bottom border-secondary py-1"
          >
            <span className="text-muted">{label}</span>
            <span>{value}</span>
          </div>
        ))}
        <div
          className="mt-2"
          style={{ fontSize: "0.72rem", color: "#94a3b8", lineHeight: 1.2 }}
        >
          <div>DeviceOrientation: heading from deviceorientation/deviceorientationabsolute.</div>
          <div>Display heading: snapped for the UI marker.</div>
          <div>Compass (raw): latest compass heading before snap.</div>
          <div>rotationRate yaw: deg/s from devicemotion.rotationRate.</div>
          <div>Acceleration: magnitude of accelerationIncludingGravity or acceleration (g).</div>
          <div>Baseline: accelerometer calibration samples.</div>
          <div>Heading offset: manual/GPS offset applied to heading.</div>
        </div>
      </div>
    </div>
  );
}
