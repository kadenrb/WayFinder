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
  if (!visible) return null;

  const rows = [
    ["Sensor msg", sensorMsg || "-"],
    ["DeviceOrientation heading", heading != null ? heading.toFixed(1) + " deg" : "-"],
    ["Display heading (snapped)", displayHeading != null ? displayHeading.toFixed(1) + " deg" : "-"],
    ["Compass (raw)", compassHeading != null ? compassHeading.toFixed(1) + " deg" : "-"],
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
    ["Recording", recording ? (recordMsg || "Recording...") : (recordMsg || "Idle")],
    ["Heading offset", headingOffset != null ? headingOffset.toFixed(1) + " deg" : "-"],
  ];

  return (
    <div className="card shadow-sm mt-3" style={{ background: "#101828", color: "#eee" }}>
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
        <div className="mt-2" style={{ fontSize: "0.72rem", color: "#94a3b8", lineHeight: 1.2 }}>
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
