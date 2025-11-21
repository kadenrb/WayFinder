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
}) {
  if (!visible) return null;

  const rows = [
    ["Sensor msg", sensorMsg || "-"],
    ["Heading", heading != null ? heading.toFixed(1) + " deg" : "-"],
    ["Display heading", displayHeading != null ? displayHeading.toFixed(1) + " deg" : "-"],
    ["Compass", compassHeading != null ? compassHeading.toFixed(1) + " deg" : "-"],
    ["Yaw", yaw != null ? yaw.toFixed(2) + " deg/s" : "-"],
    [
      "Accel magnitude",
      accelMagnitude != null ? accelMagnitude.toFixed(3) + " g" : "-",
    ],
    [
      "Baseline samples",
      baselineReady
        ? `${baselineSamples} (ready)`
        : `${baselineSamples} (calibrating)`,
    ],
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
      </div>
    </div>
  );
}
