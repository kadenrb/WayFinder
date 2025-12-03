/*
  ===============================================
  USER MAP VIEWER (Public Landing Page Experience)
  ===============================================
  ReadΓÇæonly, multiΓÇæfloor wayfinding viewer used by endΓÇæusers.
  Key capabilities:
  - Load published floors (images + points + walkable settings)
  - Let the user set their current location ("I'm here")
  - Search for a room (supports aliases/ranges)
  - Draw a route on the current floor using the walkable color mask
  - AutoΓÇæwarp between floors via stairs/elevator POIs with the same Warp Key
  - Keyboard movement with arrow keys (snaps to walkable color)

  Important: This viewer reads from localStorage (wf_public_floors). In a SaaS
  deployment, this would fetch floors.json from a hosted location on the clientΓÇÖs
  website.
*/
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StepDetector } from "./stepDetector";
import DebuggerPanel from "./DebuggerPanel";
import ShareRouteQRCode from "./ShareRouteQRCode";

// ---------------------------------------------------------------------------
// STATE AND REFS
// Everything that drives floors, routing, sensors, and debugging lives here.
// ---------------------------------------------------------------------------

function markerClass(kind) {
  switch (kind) {
    case "door":
      return "bg-secondary";
    case "poi":
      return "bg-success";
    case "room":
    default:
      return "bg-primary";
  }
}

export default function UserMap() {
  const [floors, setFloors] = useState([]); // [{id,name,url,points,walkable}]
  const [selUrl, setSelUrl] = useState("");
  const [userPos, setUserPos] = useState(null); // {x,y}
  const [placing, setPlacing] = useState(false);
  const [dest, setDest] = useState(null); // { url, id }
  const [routePts, setRoutePts] = useState([]);
  const routePtsRef = useRef([]);
  const waypointPtsRef = useRef([]);
  const [waypoints, setWaypoints] = useState([]);
  const waypointIdxRef = useRef(0);
  const planRef = useRef(null);
  const destRef = useRef(null);
  const [lastUser, setLastUser] = useState(null); // last known user position (url + pos)
  const pendingRouteRef = useRef(null); // used when we auto-switch to the user's floor before routing
  const routeResumeRef = useRef(null); // callback to resume routing when image loads
  // Cache floor images and their natural size so we can route immediately after a warp
  const imageCacheRef = useRef(new Map()); // url -> {img, w, h}
  const stepDetectorRef = useRef(null);
  const stepSampleIntervalRef = useRef(50);
  const lastStepTsRef = useRef(0);
  // ---------------------------------------------------------------------------
  // SENSOR LOOP
  // Listens for magnetometer/orientation/motion events and moves the marker.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    routePtsRef.current = Array.isArray(routePts) ? routePts : [];
  }, [routePts]);
  useEffect(() => {
    userPosRef.current = userPos;
  }, [userPos]);
  const [displayHeading, setDisplayHeading] = useState(0);
  useEffect(() => {
    routePtsRef.current = Array.isArray(routePts) ? routePts : [];
  }, [routePts]);
  const [autoWarp, setAutoWarp] = useState(true);
  const [accessibleMode, setAccessibleMode] = useState(false); // prefer elevators when crossing floors
  const [gapCells, setGapCells] = useState(0);
  const [warpProximity, setWarpProximity] = useState(0.02); // normalized distance
  const [plan, setPlan] = useState(null); // { steps:[{ url, kind:'warp'|'dest', key?, target:{x,y} }], index }
  const dragRef = useRef(null);
  const [moveStep, setMoveStep] = useState(0.01); // normalized delta per arrow key press
  const [searchText, setSearchText] = useState("");
  const [searchMsg, setSearchMsg] = useState("");
  const [routeMsg, setRouteMsg] = useState("");
  const [sensorTracking, setSensorTracking] = useState(false);
  const [sensorMsg, setSensorMsg] = useState("");
  const [debugVisible, setDebugVisible] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(10);
  const [recordMsg, setRecordMsg] = useState("");
  const shareStartRef = useRef(false);
  const [debugData, setDebugData] = useState({
    heading: 0,
    compassHeading: 0,
    yaw: 0,
    accelMagnitude: 0,
    baselineSamples: 0,
    baselineReady: false,
    sensorMsg: "",
    lastStepTs: 0,
    stepDelta: 0,
  });
  const patchDebug = (patch) => {
    setDebugData((prev) => ({ ...prev, ...patch }));
  };
  useEffect(() => {
    patchDebug({ sensorMsg });
  }, [sensorMsg]);

  // ---------------------------------------------------------------------------
  // SHARE URL ENCODING/DECODING (for QR handoff)
  // ---------------------------------------------------------------------------
  const encodeShareState = (payload) => {
    try {
      const json = JSON.stringify(payload);
      const b64 = btoa(encodeURIComponent(json));
      return b64;
    } catch {
      return null;
    }
  };
  const decodeShareState = (token) => {
    try {
      const json = decodeURIComponent(atob(token));
      return JSON.parse(json);
    } catch {
      return null;
    }
  };
  const getScreenOrientationAngle = () => {
    if (typeof window === "undefined") return 0;
    const orientation = window.screen && window.screen.orientation;
    if (orientation && typeof orientation.angle === "number") {
      return orientation.angle;
    }
    if (typeof window.orientation === "number") {
      return window.orientation;
    }
    return 0;
  };

  const normalizeAngle = (deg) => {
    let heading = deg % 360;
    if (heading < 0) heading += 360;
    if (heading >= 360) heading -= 360;
    return heading;
  };

  const quantizeHeading = (value) =>
    normalizeAngle(Math.round(value / 45) * 45);

  const loadHeadingOffset = () => {
    try {
      const raw = localStorage.getItem("wf_heading_offset");
      const val = raw ? parseFloat(raw) : 0;
      if (Number.isFinite(val)) {
        headingOffsetRef.current = normalizeAngle(val);
      }
    } catch {}
  };
  const saveHeadingOffset = (val) => {
    headingOffsetRef.current = normalizeAngle(val || 0);
    try {
      localStorage.setItem(
        "wf_heading_offset",
        headingOffsetRef.current.toString()
      );
    } catch {}
  };
  useEffect(() => {
    loadHeadingOffset();
  }, []);
  const applyHeadingOffset = (val) =>
    normalizeAngle((val || 0) + (headingOffsetRef.current || 0));

  const headingUpdateRef = useRef({ ts: 0, value: 0 });
  const limitHeadingRate = (prev, next) => {
    const now = performance && performance.now ? performance.now() : Date.now();
    const { ts = now, value = prev || 0 } = headingUpdateRef.current;
    const dtSec = Math.max(0.016, Math.min(0.5, (now - ts) / 1000));
    const maxRate = 90; // deg/s cap
    let delta = normalizeAngle(next - value);
    if (delta > 180) delta -= 360;
    const maxDelta = maxRate * dtSec;
    if (delta > maxDelta) delta = maxDelta;
    else if (delta < -maxDelta) delta = -maxDelta;
    const limited = normalizeAngle(value + delta);
    headingUpdateRef.current = { ts: now, value: limited };
    return limited;
  };

  const angularDiff = (a, b) => {
    let d = normalizeAngle(a - b);
    if (d > 180) d -= 360;
    return Math.abs(d);
  };

  const geoStableHeading = () => {
    const buf = geoBufferRef.current || [];
    const now = Date.now();
    const recent = buf.filter(
      (e) =>
        now - e.ts < 5000 && e.speed && e.speed > 0.5 && e.acc && e.acc < 50
    );
    if (recent.length < 3) return null;
    const rad = (deg) => (deg * Math.PI) / 180;
    let sx = 0,
      sy = 0;
    recent.forEach((r) => {
      sx += Math.cos(rad(r.heading));
      sy += Math.sin(rad(r.heading));
    });
    const mean = normalizeAngle((Math.atan2(sy, sx) * 180) / Math.PI);
    const maxDiff = Math.max(
      ...recent.map((r) => angularDiff(r.heading, mean))
    );
    if (maxDiff > 20) return null;
    return mean;
  };

  const gyroCalm = () => {
    const now = Date.now();
    const win = (yawWindowRef.current || []).filter((e) => now - e.ts < 2000);
    yawWindowRef.current = win;
    if (!win.length) return true;
    const maxYaw = Math.max(...win.map((e) => Math.abs(e.yaw || 0)));
    return maxYaw < 60;
  };

  const normalizeAccel = (acc = {}) => {
    const ax = acc.x || 0;
    const ay = acc.y || 0;
    const az = acc.z || 0;
    let mag = Math.sqrt(ax * ax + ay * ay + az * az);
    if (mag > 3.5) mag = mag / 9.81; // likely m/s^2; convert to g
    return { ax, ay, az, mag };
  };

  const smoothHeading = (prev, next, alpha = 0.2) => {
    if (typeof prev !== "number" || !Number.isFinite(prev))
      return normalizeAngle(next || 0);
    if (typeof next !== "number" || !Number.isFinite(next))
      return normalizeAngle(prev || 0);
    let delta = normalizeAngle(next - prev);
    if (delta > 180) delta -= 360;
    const blended = prev + alpha * delta;
    return normalizeAngle(blended);
  };

  const updateDisplayedHeading = () => {
    const heading = normalizeAngle(
      applyHeadingOffset(headingRef.current || 0) - getScreenOrientationAngle()
    );
    const snapped = quantizeHeading(heading);
    setDisplayHeading(snapped);
    patchDebug({ heading, displayHeading: snapped });
    return heading;
  };
  const gridRef = useRef(null); // cached walkable grid for current floor
  const scrollRef = useRef(null);
  const spacerRef = useRef(null);
  const contentRef = useRef(null);
  const imgRef = useRef(null);
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });
  const initialFloorSetRef = useRef(false);
  const headingRef = useRef(0);
  const northOffsetRef = useRef(0);
  const compassHeadingRef = useRef(0);
  const userPosRef = useRef(null);
  const lastMotionTsRef = useRef(null);
  const motionIdleRef = useRef(0);
  const headingOffsetRef = useRef(0);
  const geoWatchIdRef = useRef(null);
  const geoHeadingRef = useRef(null);
  const geoBufferRef = useRef([]);
  const yawWindowRef = useRef([]);
  const startPosRef = useRef(null);
  const recordDataRef = useRef([]);
  const recordStopTimerRef = useRef(null);
  const sensorBaselineRef = useRef({
    start: 0,
    samples: 0,
    ax: 0,
    ay: 0,
    az: 0,
    ready: false,
  });
  const calibrationRef = useRef({ baseline: 0, samples: 0, done: false });
  const stepStateRef = useRef({ lastStepTs: 0, active: false });
  const gyroInitializedRef = useRef(false);

  const initSensorBaseline = () => {
    const now =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    sensorBaselineRef.current = {
      start: now,
      samples: 0,
      ax: 0,
      ay: 0,
      az: 0,
      ready: false,
    };
  };

  const MANIFEST_URL =
    process.env.REACT_APP_MANIFEST_URL ||
    "https://wayfinder-floors.s3.us-east-2.amazonaws.com/floors/manifest.json";

  // ---------------------------------------------------------------------------
  // FLOOR LOADING
  // Pulls published floors from the manifest/API and stores them locally.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let aborted = false;
    const normalizeFloors = (arr = []) =>
      arr
        .map((f, index) => ({
          ...f,
          url: f.url || f.imageData || "",
          points: Array.isArray(f.points) ? f.points : [],
          walkable: f.walkable || { color: "#9F9383", tolerance: 12 },
          sortOrder: typeof f.sortOrder === "number" ? f.sortOrder : index,
        }))
        .filter((f) => f.url);

    const setInitialFloor = (list) => {
      if (!initialFloorSetRef.current && list.length) {
        setSelUrl((prev) => prev || list[0].url);
        initialFloorSetRef.current = true;
      }
    };

    const load = async () => {
      try {
        const res = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch floors");
        const data = await res.json();
        if (aborted) return;
        const normalized = normalizeFloors(data?.floors);
        if (normalized.length) {
          setFloors(normalized);
          setInitialFloor(normalized);
          return;
        }
      } catch (err) {
        console.error("Failed to load published floors from manifest", err);
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, [MANIFEST_URL]);

  // ---------------------------------------------------------------------------
  // USER POSITION PERSISTENCE
  // ---------------------------------------------------------------------------
  useEffect(() => {
    try {
      if (!selUrl) {
        setUserPos(null);
        return;
      }
      const raw = localStorage.getItem(`wf_user_pos:${selUrl}`);
      if (!raw) {
        setUserPos(null);
        return;
      }
      const p = JSON.parse(raw);
      if (p && typeof p.x === "number" && typeof p.y === "number")
        setUserPos({ x: p.x, y: p.y });
      else setUserPos(null);
    } catch {
      setUserPos(null);
    }
  }, [selUrl]);
  useEffect(() => {
    userPosRef.current = userPos;
    if (userPos && selUrl) {
      setLastUser({ url: selUrl, pos: userPos });
    }
  }, [userPos, selUrl]);
  useEffect(() => {
    setDebugData((prev) => ({ ...prev, sensorMsg }));
  }, [sensorMsg]);

  const floor = useMemo(
    () => floors.find((f) => f.url === selUrl) || null,
    [floors, selUrl]
  );
  useEffect(() => {
    northOffsetRef.current =
      typeof floor?.northOffset === "number" &&
      Number.isFinite(floor.northOffset)
        ? floor.northOffset
        : 0;
  }, [floor]);
  useEffect(() => {
    northOffsetRef.current =
      typeof floor?.northOffset === "number" &&
      Number.isFinite(floor.northOffset)
        ? floor.northOffset
        : 0;
  }, [floor]);

  // ---------------------------------------------------------------------------
  // COORDINATE / GRID HELPERS
  // Translate between pixel and normalized space and snap to walkable cells.
  // ---------------------------------------------------------------------------
  const toNorm = (clientX, clientY) => {
    const el = spacerRef.current;
    const rect = el?.getBoundingClientRect();
    if (!rect || !natSize.w || !natSize.h) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const x = Math.min(1, Math.max(0, sx / natSize.w));
    const y = Math.min(1, Math.max(0, sy / natSize.h));
    return { x, y };
  };
  const toPx = (x, y) => ({ x: x * natSize.w, y: y * natSize.h });
  // Image load: update natural size, cache it, rebuild grid, and resume any pending route after a warp
  const onImgLoad = (e) => {
    const w = e.target.naturalWidth;
    const h = e.target.naturalHeight;
    setNatSize({ w, h });
    // Cache this image size for reuse to avoid waiting on naturalWidth after a warp
    if (selUrl) {
      imageCacheRef.current.set(selUrl, { img: e.target, w, h });
    }
    // Build/capture walkable grid for this floor
    const f = floors.find((fl) => fl.url === selUrl);
    if (f) {
      const colors = [
        hexToRgb(f.walkable?.color || "#9F9383"),
        ...(Array.isArray(f.walkable?.extraColors)
          ? f.walkable.extraColors.map((c) => hexToRgb(normHex(c)))
          : []),
      ];
      Promise.resolve(buildGrid(e.target, colors, f.walkable?.tolerance, 4))
        .then((g) => {
          gridRef.current = g;
        })
        .catch(() => {
          gridRef.current = null;
        });
    }
    // Resume pending route once the image is ready (after switching floors)
    if (routeResumeRef.current) {
      const resume = routeResumeRef.current;
      routeResumeRef.current = null;
      resume();
    }
  };

  const saveUserPos = (url, p) => {
    try {
      localStorage.setItem(`wf_user_pos:${url || ""}`, JSON.stringify(p));
    } catch {}
  };

  // Apply shared route state from ?share= (base64-encoded JSON) on initial load
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("share");
    if (!token) return;
    const data = decodeShareState(token);
    if (!data) return;
    if (typeof data.accessibleMode === "boolean") {
      setAccessibleMode(data.accessibleMode);
    }
    if (data.startUrl) {
      setSelUrl(data.startUrl);
    }
    if (data.startPos) {
      setUserPos(data.startPos);
      saveUserPos(data.startUrl || selUrl, data.startPos);
    }
    if (data.destId) {
      destRef.current = { id: data.destId };
      setDest({ url: data.startUrl || selUrl, id: data.destId });
    }
    shareStartRef.current = true;
  }, []);

  // Snap a normalized position to nearest walkable cell center (using cached grid)
  const snapToWalkable = (nx, ny) => {
    const g = gridRef.current;
    const img = imgRef.current;
    const f = floors.find((fl) => fl.url === selUrl);
    if (!g || !img || !f) return { x: nx, y: ny };
    const { grid, gw, gh, step, w, h } = g;
    const cx = Math.max(0, Math.min(gw - 1, Math.round((nx * w) / step)));
    const cy = Math.max(0, Math.min(gh - 1, Math.round((ny * h) / step)));
    const near = nearestWalkable(grid, gw, gh, cx, cy);
    if (!near) return { x: nx, y: ny };
    return {
      x: (near[0] * step + step / 2) / w,
      y: (near[1] * step + step / 2) / h,
    };
  };

  // -------- Room search helpers (roomNumber and aliases/ranges) --------
  const normCode = (s) =>
    (s || "")
      .toString()
      .toUpperCase()
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\s+/g, "")
      .trim();
  const parseCode = (s) => {
    const m = /^([A-Z]*)(\d+)$/.exec(s);
    if (!m) return null;
    return { prefix: m[1] || "", num: parseInt(m[2], 10) };
  };
  const parseRange = (s) => {
    const parts = s.split("-");
    if (parts.length !== 2) return null;
    const a = parseCode(parts[0]);
    const b = parseCode(parts[1]);
    if (!a || !b || a.prefix !== b.prefix) return null;
    const start = Math.min(a.num, b.num),
      end = Math.max(a.num, b.num);
    return { prefix: a.prefix, start, end };
  };
  const matchesPointCode = (p, code) => {
    if (!code) return false;
    const c = normCode(code);
    const rn = normCode(p.roomNumber || "");
    if (rn && rn === c) return true;
    const aliases = Array.isArray(p.aliases) ? p.aliases : [];
    for (const a of aliases) {
      const an = normCode(a);
      if (!an) continue;
      if (an.includes("-")) {
        const r = parseRange(an);
        const pc = parseCode(c);
        if (
          r &&
          pc &&
          r.prefix === pc.prefix &&
          pc.num >= r.start &&
          pc.num <= r.end
        )
          return true;
      } else {
        if (an === c) return true;
      }
    }
    return false;
  };
  const searchRoom = () => {
    const q = normCode(searchText);
    if (!q) {
      setSearchMsg("");
      return;
    }
    for (const f of floors) {
      const pts = Array.isArray(f.points) ? f.points : [];
      const hit = pts.find((p) => matchesPointCode(p, q));
      if (hit) {
        setDest({ url: f.url, id: hit.id });
        setSelUrl(f.url);
        setSearchMsg(
          `Destination set: ${
            hit.roomNumber || hit.name || hit.poiType || hit.kind
          }`
        );
        return;
      }
    }
    setSearchMsg("No matching room found");
  };

  const requestMotionPermissions = async () => {
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") throw new Error("Motion permission denied");
    }
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") throw new Error("Orientation permission denied");
    }
  };

  // Start the sensor loop: request permissions, reset calibration, seed heading
  const startSensorTracking = async () => {
    if (!userPos) {
      setSensorMsg("Place yourself on the map first.");
      return;
    }
    if (
      typeof window === "undefined" ||
      typeof DeviceMotionEvent === "undefined"
    ) {
      setSensorMsg("Device motion API not supported.");
      return;
    }
    try {
      await requestMotionPermissions();
      calibrationRef.current = { baseline: 0, samples: 0, done: false };
      stepStateRef.current = {
        lastStepTs: performance.now ? performance.now() : Date.now(),
        active: false,
      };
      gyroInitializedRef.current = false;
      initSensorBaseline();
      headingRef.current = compassHeadingRef.current || headingRef.current || 0;
      updateDisplayedHeading();
      // start geolocation heading watcher for hints
      if (navigator.geolocation && !geoWatchIdRef.current) {
        geoWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const h = pos?.coords?.heading;
            const spd = pos?.coords?.speed;
            const acc = pos?.coords?.accuracy;
            if (
              typeof h === "number" &&
              Number.isFinite(h) &&
              h >= 0 &&
              h < 360
            ) {
              const entry = { heading: h, speed: spd, acc, ts: Date.now() };
              geoHeadingRef.current = entry;
              const buf = geoBufferRef.current || [];
              buf.push(entry);
              geoBufferRef.current = buf
                .filter((e) => entry.ts - e.ts < 8000)
                .slice(-20);
            }
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 }
        );
      }
      setSensorTracking(true);
      setSensorMsg("Calibrating sensors. Hold still...");
      patchDebug({
        baselineSamples: 0,
        baselineReady: false,
        sensorMsg: "Calibrating sensors. Hold still...",
      });
    } catch (err) {
      setSensorMsg(err?.message || "Sensor permission denied.");
      patchDebug({ sensorMsg: err?.message || "Sensor permission denied." });
      setSensorTracking(false);
    }
  };

  // Stop sensors and wipe calibration so future sessions start clean
  const stopSensorTracking = () => {
    setSensorTracking(false);
    setSensorMsg("Tracking paused.");
    if (geoWatchIdRef.current && navigator.geolocation) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
      geoHeadingRef.current = null;
    }
    calibrationRef.current = { baseline: 0, samples: 0, done: false };
    stepStateRef.current = { lastStepTs: 0, active: false };
    gyroInitializedRef.current = false;
    sensorBaselineRef.current = {
      start: 0,
      samples: 0,
      ax: 0,
      ay: 0,
      az: 0,
      ready: false,
    };
    patchDebug({
      sensorMsg: "Tracking paused.",
      baselineSamples: 0,
      baselineReady: false,
      accelMagnitude: 0,
      yaw: 0,
      stepDelta: 0,
    });
  };

  const stopRecording = (download = true) => {
    if (recordStopTimerRef.current) {
      clearTimeout(recordStopTimerRef.current);
      recordStopTimerRef.current = null;
    }
    if (!recording) return;
    setRecording(false);
    const samples = recordDataRef.current || [];
    if (download && samples.length) {
      const blob = new Blob([JSON.stringify(samples, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wf-sensors-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setRecordMsg(`Downloaded ${samples.length} samples.`);
    } else {
      setRecordMsg(`Recording stopped (${samples.length} samples).`);
    }
  };

  const startRecording = () => {
    const secs = Math.max(1, Math.min(120, Number(recordDuration) || 10));
    setRecordDuration(secs);
    recordDataRef.current = [];
    startPosRef.current = userPosRef.current || null;
    setRecordMsg(`Recording for ${secs}s...`);
    setRecording(true);
    if (recordStopTimerRef.current) clearTimeout(recordStopTimerRef.current);
    recordStopTimerRef.current = setTimeout(
      () => stopRecording(true),
      secs * 1000
    );
  };

  const logSample = (sample, force = false) => {
    if (!recording && !force) return;
    recordDataRef.current.push({
      t: Date.now(),
      url: selUrl,
      userPos: userPosRef.current,
      ...sample,
    });
  };

  useEffect(() => () => stopRecording(false), []);

  // ---------------------------------------------------------------------------
  // DESKTOP SPOOFED MOVEMENT
  // Arrow keys move the marker for testing without a phone.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (!userPos) return; // require an existing position
      let dx = 0,
        dy = 0;
      if (e.key === "ArrowLeft") dx = -moveStep;
      else if (e.key === "ArrowRight") dx = moveStep;
      else if (e.key === "ArrowUp") dy = -moveStep;
      else if (e.key === "ArrowDown") dy = moveStep;
      else return;
      e.preventDefault();
      const nx = Math.min(1, Math.max(0, userPos.x + dx));
      const ny = Math.min(1, Math.max(0, userPos.y + dy));
      const p = snapToWalkable(nx, ny);
      setUserPos(p);
      saveUserPos(selUrl, p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userPos, moveStep, selUrl]);

  // Wire devicemotion to the step detector and waypoint stepper
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof DeviceMotionEvent === "undefined"
    )
      return;
    stepDetectorRef.current = new StepDetector({
      sampleIntervalMs: stepSampleIntervalRef.current,
      windowMs: 2000,
    });
    const handler = (event) => {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;
      if (event.interval && !stepSampleIntervalRef.currentInitialized) {
        const ms = Math.max(10, Math.round(event.interval));
        stepSampleIntervalRef.current = ms;
        if (stepDetectorRef.current?.setSampleInterval) {
          stepDetectorRef.current.setSampleInterval(ms);
        }
        stepSampleIntervalRef.currentInitialized = true;
      }
      const ax = acc.x || 0;
      const ay = acc.y || 0;
      const az = acc.z || 0;
      const stepDetected = stepDetectorRef.current.update(ax, ay, az);
      if (stepDetected) {
        const now = Date.now();
        if (now - (lastStepTsRef.current || 0) >= 400) {
          lastStepTsRef.current = now;
          stepWaypoint();
        }
      }
    };
    window.addEventListener("devicemotion", handler);
    return () => window.removeEventListener("devicemotion", handler);
  }, [stepWaypoint]);

  // Helpers similar to editor for routing
  const normHex = (s) => {
    if (!s) return "#000000";
    let t = s.toString().trim().toUpperCase();
    if (!t.startsWith("#")) t = "#" + t;
    if (t.length === 4) t = "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    return /^#[0-9A-F]{6}$/.test(t) ? t : "#000000";
  };
  const hexToRgb = (hex) => {
    const h = normHex(hex);
    return [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
  };
  // Build a walkable grid using one or more colors. Colors is [[r,g,b], ...].
  const buildGrid = async (imgEl, colors, tol, step = 4) => {
    const w = imgEl.naturalWidth || imgEl.width,
      h = imgEl.naturalHeight || imgEl.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(imgEl, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    const data = id.data;
    const gw = Math.max(1, Math.floor(w / step)),
      gh = Math.max(1, Math.floor(h / step));
    const grid = new Uint8Array(gw * gh);
    const tolv = Math.max(0, Math.min(255, tol || 0));
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const px = Math.min(w - 1, gx * step + (step >> 1));
        const py = Math.min(h - 1, gy * step + (step >> 1));
        const idx = (py * w + px) * 4;
        const r = data[idx],
          g = data[idx + 1],
          b = data[idx + 2];
        let pass = 0;
        for (const [tr, tg, tb] of colors) {
          const dr = r - tr,
            dg = g - tg,
            db = b - tb;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          if (dist <= tolv) {
            pass = 1;
            break;
          }
        }
        grid[gy * gw + gx] = pass;
      }
    }
    return { grid, gw, gh, step, w, h };
  };
  const nearestWalkable = (grid, gw, gh, sx, sy) => {
    const inb = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh;
    const q = [[sx, sy]];
    const seen = new Set([sy * gw + sx]);
    if (grid[sy * gw + sx]) return [sx, sy];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of dirs) {
        const nx = x + dx,
          ny = y + dy;
        const k = ny * gw + nx;
        if (!inb(nx, ny) || seen.has(k)) continue;
        seen.add(k);
        if (grid[k]) return [nx, ny];
        q.push([nx, ny]);
      }
    }
    return null;
  };
  const bfs = (grid, gw, gh, s, t, gap = 0) => {
    const inb = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    const prev = new Int32Array(gw * gh).fill(-1);
    const seen = new Uint8Array(gw * gh);
    const q = [];
    const sIdx = s[1] * gw + s[0],
      tIdx = t[1] * gw + t[0];
    q.push(sIdx);
    seen[sIdx] = 1;
    while (q.length) {
      const cur = q.shift();
      if (cur === tIdx) break;
      const cx = cur % gw,
        cy = (cur / gw) | 0;
      for (const [dx, dy] of dirs) {
        let nx = cx + dx,
          ny = cy + dy;
        if (!inb(nx, ny)) continue;
        let tgt = -1;
        const nIdx = ny * gw + nx;
        if (grid[nIdx]) tgt = nIdx;
        else if (gap > 0) {
          for (let k = 2; k <= gap + 1; k++) {
            const nx2 = cx + dx * k,
              ny2 = cy + dy * k;
            if (!inb(nx2, ny2)) break;
            const idx2 = ny2 * gw + nx2;
            if (grid[idx2]) {
              tgt = idx2;
              break;
            }
          }
        }
        if (tgt === -1) continue;
        if (seen[tgt]) continue;
        seen[tgt] = 1;
        prev[tgt] = cur;
        q.push(tgt);
      }
    }
    if (prev[tIdx] === -1 && sIdx !== tIdx) return null;
    const out = [];
    for (let cur = tIdx; cur !== -1; cur = prev[cur]) {
      const x = cur % gw,
        y = (cur / gw) | 0;
      out.push([x, y]);
      if (cur === sIdx) break;
    }
    out.reverse();
    return out;
  };

  // Build evenly spaced waypoints along a route polyline (normalized coords)
  const buildWaypoints = (pts, spacingNorm = 1 / 700) => {
    if (!pts || pts.length < 2) return [];
    const out = [pts[0]];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      let t = spacingNorm - acc;
      while (t <= segLen) {
        const ratio = t / segLen;
        out.push({
          x: a.x + (b.x - a.x) * ratio,
          y: a.y + (b.y - a.y) * ratio,
        });
        t += spacingNorm;
      }
      acc =
        segLen + acc - Math.floor((segLen + acc) / spacingNorm) * spacingNorm;
    }
    if (out[out.length - 1] !== pts[pts.length - 1])
      out.push(pts[pts.length - 1]);
    return out;
  };

  // Simplify a polyline using Ramer-Douglas-Peucker and colinear collapse to reduce zig-zags from the grid path
  const simplifyRoute = (pts, epsilon = 0.003) => {
    if (!pts || pts.length < 3) return pts || [];
    const sq = (v) => v * v;
    const distSqToSegment = (p, a, b) => {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const apx = p.x - a.x;
      const apy = p.y - a.y;
      const abLenSq = abx * abx + aby * aby || 1e-9;
      let t = (apx * abx + apy * aby) / abLenSq;
      t = Math.max(0, Math.min(1, t));
      const projx = a.x + t * abx;
      const projy = a.y + t * aby;
      return sq(p.x - projx) + sq(p.y - projy);
    };
    const rdp = (arr) => {
      if (arr.length < 3) return arr;
      let maxIdx = 0;
      let maxDistSq = 0;
      const start = arr[0];
      const end = arr[arr.length - 1];
      for (let i = 1; i < arr.length - 1; i++) {
        const d = distSqToSegment(arr[i], start, end);
        if (d > maxDistSq) {
          maxDistSq = d;
          maxIdx = i;
        }
      }
      if (Math.sqrt(maxDistSq) <= epsilon) {
        return [start, end];
      }
      const left = rdp(arr.slice(0, maxIdx + 1));
      const right = rdp(arr.slice(maxIdx));
      return left.slice(0, -1).concat(right);
    };
    // First RDP
    let simplified = rdp(pts);
    // Then collapse nearly-colinear points (angle change below threshold)
    const angle = (a, b, c) => {
      const abx = b.x - a.x, aby = b.y - a.y;
      const bcx = c.x - b.x, bcy = c.y - b.y;
      const dot = abx * bcx + aby * bcy;
      const mag1 = Math.hypot(abx, aby) || 1e-9;
      const mag2 = Math.hypot(bcx, bcy) || 1e-9;
      const cos = dot / (mag1 * mag2);
      return Math.acos(Math.max(-1, Math.min(1, cos)));
    };
    const collapsed = [simplified[0]];
    for (let i = 1; i < simplified.length - 1; i++) {
      const a = collapsed[collapsed.length - 1];
      const b = simplified[i];
      const c = simplified[i + 1];
      const ang = angle(a, b, c);
      if (ang > (5 * Math.PI) / 180) {
        collapsed.push(b);
      }
    }
    collapsed.push(simplified[simplified.length - 1]);
    return collapsed;
  };

  const routeDirection = () => {
    return null;
  };

  const routeHeadingDeg = () => {
    // Route-locked mode uses waypoint progression; heading is updated when stepping.
    return headingRef.current || 0;
  };

  const waypointStride = 2; // advance this many waypoints per detected step/click

  async function stepWaypoint() {
    const pts =
      waypointPtsRef.current && waypointPtsRef.current.length
        ? waypointPtsRef.current
        : waypoints;
    if (!pts || !pts.length) {
      setSensorMsg("No route available; build a route first.");
      return;
    }
    let currentIdx =
      typeof waypointIdxRef.current === "number" ? waypointIdxRef.current : 0;
    if (currentIdx < 0 || currentIdx >= pts.length) currentIdx = 0;
    // advance forward by stride
    currentIdx = Math.min(currentIdx + waypointStride, pts.length - 1);
    waypointIdxRef.current = currentIdx;
    const target = pts[currentIdx];
    setUserPos(target);
    saveUserPos(selUrl, target);
    userPosRef.current = target;
    const dx = target.x - (userPos?.x ?? target.x);
    const dy = target.y - (userPos?.y ?? target.y);
    const headingDeg = normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
    setDisplayHeading(quantizeHeading(headingDeg));
    console.log("Step route", { currentIdx, target, waypoints: pts.length });
    setSensorMsg(`Moved to waypoint ${currentIdx + 1}/${pts.length}`);
  }

  // Build a cross-floor plan from current floor to destination floor using shared warp keys
  const normalizeKey = (k) =>
    typeof k === "string" ? k.trim().toLowerCase() : "";
  const sharedWarpKeys = (a, b) => {
    const A = new Set(),
      B = new Set();
    (a?.points || []).forEach((p) => {
      if (
        p?.kind === "poi" &&
        (p.poiType === "stairs" || p.poiType === "elevator") &&
        p.warpKey
      )
        A.add(normalizeKey(p.warpKey));
    });
    (b?.points || []).forEach((p) => {
      if (
        p?.kind === "poi" &&
        (p.poiType === "stairs" || p.poiType === "elevator") &&
        p.warpKey
      )
        B.add(normalizeKey(p.warpKey));
    });
    const out = [];
    for (const k of A) if (B.has(k)) out.push(k);
    return out;
  };
  const makePlan = (fromUrl, toUrl) => {
    if (!fromUrl || !toUrl || fromUrl === toUrl)
      return [{ url: fromUrl, kind: "dest" }];
    const urls = floors.map((f) => f.url);
    const prev = new Map([[fromUrl, null]]);
    const q = [fromUrl];
    const keysByUrl = new Map(
      floors.map((f) => [
        f.url,
        new Set(
          (f.points || [])
            .filter(
              (p) =>
                p?.warpKey &&
                (p.poiType === "stairs" || p.poiType === "elevator")
            )
            .map((p) => normalizeKey(p.warpKey))
        ),
      ])
    );
    while (q.length) {
      const u = q.shift();
      if (u === toUrl) break;
      for (const v of urls) {
        if (prev.has(v) || v === u) continue;
        const A = keysByUrl.get(u) || new Set();
        const B = keysByUrl.get(v) || new Set();
        let ok = false;
        for (const k of A) {
          if (B.has(k)) {
            ok = true;
            break;
          }
        }
        if (ok) {
          prev.set(v, u);
          q.push(v);
        }
      }
    }
    if (!prev.has(toUrl)) return [{ url: fromUrl, kind: "dest" }];
    const chain = [];
    for (let at = toUrl; at; at = prev.get(at)) chain.push(at);
    chain.reverse();
    return chain.map((u, i) => ({
      url: u,
      kind: i === chain.length - 1 ? "dest" : "warp",
    }));
  };

  const computeRouteForStep = async (
    step,
    startPosOverride = null,
    planArg = null,
    fallbackUsed = false,
    gapOverride = null
  ) => {
    const curFloor = floors.find(f=>f.url===selUrl); if (!curFloor) return;
    const img = imgRef.current; if (!img || !img.naturalWidth) { setSensorMsg("Image not ready for routing."); return; }
    const baseColors = [hexToRgb(curFloor.walkable?.color || "#9F9383")];
    const extraColors = Array.isArray(curFloor.walkable?.extraColors)
      ? curFloor.walkable.extraColors.map((c) => hexToRgb(normHex(c)))
      : [];
    const tol = curFloor.walkable?.tolerance;

    const buildGridTry = async (useExtra) => {
      const cols = useExtra ? baseColors.concat(extraColors) : baseColors;
      return buildGrid(img, cols, tol, 4);
    };

    const tryBuild = async (useExtra) => {
      const obj = await buildGridTry(useExtra);
      const { grid, gw, gh, step: stp, w, h } = obj;
      const startPos = startPosOverride || userPos;
      if (!startPos) return { obj, sCell: null, w, h, stp, gw, gh };
      const ux = Math.max(0, Math.min(gw - 1, Math.round((startPos.x * w) / stp)));
      const uy = Math.max(0, Math.min(gh - 1, Math.round((startPos.y * h) / stp)));
      const sCell = nearestWalkable(grid, gw, gh, ux, uy);
      return { obj, sCell, w, h, stp, gw, gh };
    };

    let attempt = await tryBuild(false);
    if (!attempt.sCell && extraColors.length) {
      attempt = await tryBuild(true);
    }
    if (!attempt.sCell) {
      setRoutePts([]);
      return;
    }

    const { obj: gridObj, sCell, w, h, stp, gw, gh } = attempt;
    let target = null;
    if (step.kind === "dest") {
      const destFloor = floors.find((f) =>
        f.points?.some((p) => p.id === dest?.id)
      );
      const dp =
        destFloor && destFloor.url === selUrl
          ? destFloor.points.find((p) => p.id === dest.id)
          : null;
      if (!dp) {
        setRoutePts([]);
        return;
      }
      target = { x: dp.x, y: dp.y };
    } else {
      // step.kind==='warp': pick nearest shared warp to user among keys shared with next floor
      const nextUrl =
        plan && plan.steps[plan.index + 1]
          ? plan.steps[plan.index + 1].url
          : null;
      const shared = sharedWarpKeys(
        curFloor,
        floors.find((f) => f.url === nextUrl) || {}
      );
      let best = null,
        bestD = Infinity;
      const candidates = (curFloor.points || []).filter(
        (p) =>
          p?.kind === "poi" &&
          (p.poiType === "stairs" || p.poiType === "elevator") &&
          p.warpKey &&
          shared.includes(normalizeKey(p.warpKey))
      );
      if (!candidates.length) {
        setRouteMsg("No shared warp keys between these floors.");
        setSensorMsg("No shared warp keys between these floors.");
        setRoutePts([]);
        return;
      }
      const elevators = accessibleMode
        ? candidates.filter((p) => p.poiType === "elevator")
        : [];
      const pool = elevators.length ? elevators : candidates;
      if (!pool.length) {
        setRouteMsg("No usable warps on this floor.");
        setSensorMsg("No usable warps on this floor.");
        setRoutePts([]);
        return;
      }
      // Prefer the warp pair that is closest to the destination on the next floor, then break ties by user distance
      const nextUrl2 =
        planArg && planArg.steps ? planArg.steps[planArg.index + 1]?.url : null;
      const nextFloor = nextUrl2
        ? floors.find((f) => f.url === nextUrl2)
        : null;
      const destId = dest?.id || destRef.current?.id;
      const destPoint =
        destId && nextFloor
          ? (nextFloor.points || []).find((p) => p.id === destId)
          : null;

      // Find the warp key whose counterpart on the next floor is closest to the destination
      let bestKey = null;
      let bestDestDist = Infinity;
      if (destPoint && nextFloor) {
        for (const p of pool) {
          const matches = (nextFloor.points || []).filter(
            (np) =>
              np?.kind === "poi" &&
              (np.poiType === "stairs" || np.poiType === "elevator") &&
              np.warpKey &&
              normalizeKey(np.warpKey) === normalizeKey(p.warpKey)
          );
          if (!matches.length) continue;
          const dist = Math.min(
            ...matches.map((m) =>
              Math.hypot(m.x - destPoint.x, m.y - destPoint.y)
            )
          );
          if (dist < bestDestDist) {
            bestDestDist = dist;
            bestKey = normalizeKey(p.warpKey);
          }
        }
      }

      for (const p of pool) {
        const keyNorm = normalizeKey(p.warpKey);
        if (bestKey && keyNorm !== bestKey) continue;
        const distUser = Math.hypot(p.x - userPos.x, p.y - userPos.y);
        if (distUser < bestD) {
          bestD = distUser;
          best = p;
        }
      }
      if (!best) {
        setRoutePts([]);
        return;
      }
      target = { x: best.x, y: best.y };
      // Store current warp target on step for proximity check
      step.key = normalizeKey(best.warpKey);
      step.target = target;
    }
    const tx=Math.max(0,Math.min(gw-1,Math.round((target.x*w)/stp))); const ty=Math.max(0,Math.min(gh-1,Math.round((target.y*h)/stp)));
    const tCell = nearestWalkable(gridObj.grid, gw, gh, tx, ty);
    if (!tCell) {
      setRoutePts([]);
      return;
    }
    const gapVal = Math.max(0, Math.floor(gapOverride ?? gapCells ?? 0));
    const path = bfs(gridObj.grid,gw,gh,sCell,tCell, gapVal);
    if (!path || path.length<2) {
      if (!fallbackUsed && gapVal === 0) {
        await computeRouteForStep(step, startPosOverride, planArg, true, 1);
      } else {
        setRoutePts([]);
      }
      return;
    }
    const out = path.map(([gx,gy])=> ({ x: ((gx*stp)+(stp/2))/w, y: ((gy*stp)+(stp/2))/h }));
    const simpTol = 0.003 + gapVal * 0.003; // higher gap -> allow more smoothing
    const simplified = simplifyRoute(out, simpTol);
    routePtsRef.current = simplified;
    // Only (re)build waypoints and reset index if waypointIdxRef is at 0 (initial build)
    if (waypointIdxRef.current === 0) {
      let wp = buildWaypoints(simplified);
      const startPt = wp[0];
      const endPt = wp[wp.length - 1];
      const userPt = userPos || startPt;
      const dStart = Math.hypot(
        (startPt?.x || 0) - (userPt?.x || 0),
        (startPt?.y || 0) - (userPt?.y || 0)
      );
      const dEnd = Math.hypot(
        (endPt?.x || 0) - (userPt?.x || 0),
        (endPt?.y || 0) - (userPt?.y || 0)
      );
      if (dEnd < dStart) wp = [...wp].reverse();
      waypointIdxRef.current = 0; // start at beginning of path (user side)
      waypointPtsRef.current = wp;
      setWaypoints(wp);
      setSensorMsg(
        `Route ready: ${out.length} points, waypoints: ${wp.length}`
      );
    }
    setRoutePts(simplified);
  };

  const sharePayload = useMemo(() => {
    if (!selUrl || !userPos || !dest?.id) return null;
    return {
      startUrl: selUrl,
      startPos: userPos,
      destId: dest.id,
      accessibleMode,
    };
  }, [selUrl, userPos, dest, accessibleMode]);

  const shareUrl = useMemo(() => {
    if (!sharePayload) return "";
    const token = encodeShareState(sharePayload);
    if (!token) return "";
    if (typeof window === "undefined") return "";
    const base =
      (window.location && window.location.origin) ||
      `${window.location.protocol}//${window.location.host}`;
    const path = window.location ? window.location.pathname : "";
    return `${base}${path}?share=${token}`;
  }, [sharePayload]);

  const startRouteInternal = async (startPos, targetDest) => {
    const floor = floors.find((f) => f.url === selUrl);
    if (!floor || !startPos || !targetDest) return;
    const destFloor = floors.find((f) =>
      f.points?.some((p) => p.id === targetDest.id)
    );
    if (!destFloor) {
      setRouteMsg("Destination not found on any floor.");
      console.info("Route: destination not found", targetDest);
      return;
    }
    const steps = makePlan(selUrl, destFloor.url);
    if (steps.length === 1 && destFloor.url !== selUrl) {
      const shared = sharedWarpKeys(
        floors.find((f) => f.url === selUrl),
        destFloor
      );
      setRouteMsg("No shared warp keys between these floors.");
      setSensorMsg("No shared warp keys between these floors.");
      console.info("Route: no path across floors", {
        from: selUrl,
        to: destFloor.url,
        sharedKeys: shared,
      });
      return;
    }
    const planObj = { steps, index: 0 };
    planRef.current = planObj;
    setPlan(planObj);
    console.info("Route: plan built", planObj);
    // Prefetch next floor image if plan spans floors so routing can resume immediately after warp
    const next = planObj.steps[1];
    if (next && next.url && !imageCacheRef.current.has(next.url)) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imageCacheRef.current.set(next.url, {
          img,
          w: img.naturalWidth,
          h: img.naturalHeight,
        });
      };
      img.src = next.url;
    }
    await computeRouteForStep(planObj.steps[0], startPos, planObj);
  };

  const startRoute = async () => {
    const destId = dest?.id || destRef.current?.id;
    const targetDest = dest || destRef.current;
    if (!targetDest) {
      setRouteMsg("Select a destination room first.");
      return;
    }
    const startPos = userPos || lastUser?.pos;
    const startUrl = userPos ? selUrl : lastUser?.url;
    if (!startPos || !startUrl) {
      setRouteMsg("Place yourself on the map first.");
      return;
    }

    // If we are not viewing the user's floor, switch there before routing
    if (startUrl !== selUrl) {
      pendingRouteRef.current = { startPos, startUrl, destId };
      setSensorMsg("Switching to your floor to build the route...");
      setSelUrl(startUrl);
      return;
    }

    await startRouteInternal(startPos, targetDest);
  };

  // Kick off routing automatically after applying a shared link
  useEffect(() => {
    if (!shareStartRef.current) return;
    const targetDest = dest || destRef.current;
    if (!userPos || !targetDest) return;
    const maybeFinish = () => {
      if (!pendingRouteRef.current) {
        shareStartRef.current = false;
      }
    };
    startRoute().finally(maybeFinish);
  }, [userPos, dest, selUrl]);

  const clearRoute = () => {
    setRoutePts([]);
    setPlan(null);
    planRef.current = null;
    routePtsRef.current = [];
    waypointPtsRef.current = [];
    setWaypoints([]);
    waypointIdxRef.current = 0;
    pendingRouteRef.current = null;
  };

  // Auto-warp when near target warp
  useEffect(() => {
    if (!autoWarp) return;
    if (!plan || !plan.steps || plan.index >= plan.steps.length) return;
    const step = plan.steps[plan.index];
    if (step.kind !== "warp" || !step.target) return;
    if (!userPos) return;
    const d = Math.hypot(userPos.x - step.target.x, userPos.y - step.target.y);
    if (d <= warpProximity) {
      // Switch to next floor and place user at matching warp
      const planObj = planRef.current || plan;
      const next =
        planObj && planObj.steps ? planObj.steps[planObj.index + 1] : null;
      if (!next) return;
      const curFloor = floors.find((f) => f.url === selUrl);
      const nextFloor = floors.find((f) => f.url === next.url);
      const match = (nextFloor?.points || []).find(
        (p) =>
          p?.kind === "poi" &&
          (p.poiType === "stairs" || p.poiType === "elevator") &&
          p.warpKey &&
          normalizeKey(p.warpKey) === step.key
      );
      if (match) {
        const landing = { x: match.x, y: match.y };
        saveUserPos(nextFloor.url, landing);
        const destId = dest?.id || destRef.current?.id || null;
        const targetDest =
          dest ||
          destRef.current ||
          floors.flatMap((f) => f.points || []).find((p) => p.id === destId) ||
          null;
        // Schedule resume once next image loads; do not route immediately because image/pos may not be ready yet
        pendingRouteRef.current = {
          startPos: landing,
          startUrl: nextFloor.url,
          destId,
        };
        routeResumeRef.current = () => {
          const tgt = targetDest || (destId && { id: destId });
          if (tgt) destRef.current = tgt;
          startRouteInternal(landing, tgt);
        };
        setSelUrl(nextFloor.url);
        setPlan((p) => {
          if (!p) return p;
          const updated = { ...p, index: p.index + 1 };
          planRef.current = updated;
          return updated;
        });
        setRoutePts([]);
        // Fallback timer in case onImgLoad does not fire
        setTimeout(() => {
          if (routeResumeRef.current) {
            const resume = routeResumeRef.current;
            routeResumeRef.current = null;
            resume();
          }
        }, 2500);
      }
    }
  }, [autoWarp, userPos, plan, floors, selUrl, warpProximity]);

  // If a shared route switched floors, retry starting once we're on that floor
  useEffect(() => {
    if (!shareStartRef.current) return;
    if (!pendingRouteRef.current) return;
    if (pendingRouteRef.current.startUrl !== selUrl) return;
    startRoute();
  }, [selUrl]);

  // Recompute route when floor switches within an active plan
  // Recompute route when floor switches within an active plan (but not on userPos changes)
  useEffect(() => {
    (async () => {
      // If we switched floors for a pending route, resume once the image is ready (onImgLoad will trigger resume)
      if (
        pendingRouteRef.current &&
        pendingRouteRef.current.startUrl === selUrl
      ) {
        const { startPos, destId } = pendingRouteRef.current;
        const targetDest =
          dest ||
          destRef.current ||
          floors.flatMap((f) => f.points || []).find((p) => p.id === destId) ||
          null;
        console.info(
          "Route: resuming pending route after floor switch",
          pendingRouteRef.current
        );
        pendingRouteRef.current = null;
        if (targetDest) {
          destRef.current = targetDest;
          // wait for the image to load before rerouting; hook into onImgLoad
          routeResumeRef.current = () =>
            startRouteInternal(startPos, targetDest);
          // fallback timer in case onImgLoad never fires
          setTimeout(() => {
            if (routeResumeRef.current) {
              routeResumeRef.current();
              routeResumeRef.current = null;
            }
          }, 2500);
          return;
        }
      }
      if (!plan || !plan.steps || plan.index >= plan.steps.length) return;
      const step = plan.steps[plan.index];
      if (step.url !== selUrl) return;
      await computeRouteForStep(step, null, plan);
    })();
  }, [selUrl, plan, gapCells]);

  // ---------------------------------------------------------------------------
  // RENDER
  // Everything below handles layout, map interactions, and debug UI.
  // ---------------------------------------------------------------------------
  return (
    <div className="card shadow-sm bg-card">
      <div className="card-body">
        <h5 className="card-title text-card h1 mb-3 text-center">Public Map</h5>
        <div className="d-flex flex-wrap">
          <div className="flex-grow-1 d-flex align-items-center gap-3 mb-4">
            <select
              className="form-select form-select-sm bg-card-inner"
              value={selUrl}
              onChange={(e) => setSelUrl(e.target.value)}
            >
              {floors.map((f) => (
                <option key={f.url} value={f.url}>
                  {f.name || "floor"}
                </option>
              ))}
            </select>

            <button
              className={`btn p-2 btn-sm rounded-pill ${
                placing ? "btn-dark" : "btn-outline-dark text-white"
              }`}
              onClick={() => setPlacing((p) => !p)}
            >
              {placing ? "Click map to set location" : "Manually set location"}
            </button>
          </div>
          <div className="d-flex gap-2 mb-2 flex-grow-1 justify-content-center">
            <input
              className="form-control form-control-xl bg-card-inner"
              placeholder="Search room (e.g., B500)"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchRoom();
              }}
            />

            <button
              className="btn btn-info text-white px-3 flex-grow-1 rounded-4"
              onClick={searchRoom}
            >
              Search
            </button>
          </div>
        </div>
        <div className="d-flex mb-2 w-100">
          <button
            className="btn btn-primary flex-grow-1 rounded-4"
            onClick={startRoute}
            disabled={!userPos || !dest}
          >
            Route
          </button>
        </div>

        {floor && (
          <div
            className="position-relative"
            ref={scrollRef}
            style={{ overflow: "auto", maxHeight: 600, borderRadius: 10 }}
          >
            <div
              ref={spacerRef}
              className="position-relative"
              style={{ width: natSize.w, height: natSize.h }}
            >
              <div
                ref={contentRef}
                className="position-absolute"
                style={{
                  left: 0,
                  top: 0,
                  width: natSize.w,
                  height: natSize.h,
                  cursor: placing ? "crosshair" : "default",
                }}
                onClick={(e) => {
                  if (!placing) return;
                  const raw = toNorm(e.clientX, e.clientY);
                  const p = snapToWalkable(raw.x, raw.y);
                  setUserPos(p);
                  saveUserPos(selUrl, p);
                  setPlacing(false);
                }}
              >
                <style>{`@keyframes routeDash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }`}</style>
                <img
                  ref={imgRef}
                  src={floor.url}
                  alt={floor.name || "floor"}
                  crossOrigin="anonymous"
                  onLoad={onImgLoad}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                    userSelect: "none",
                    pointerEvents: "none",
                  }}
                />

                {userPos &&
                  (() => {
                    const pos = toPx(userPos.x, userPos.y);
                    const size = 22;
                    const angle = displayHeading || 0;
                    return (
                      <div
                        key="user"
                        className="position-absolute"
                        style={{
                          left: pos.x - size / 2,
                          top: pos.y - size / 2,
                          width: size,
                          height: size,
                          pointerEvents: "none",
                          zIndex: 5,
                        }}
                        title="You"
                      >
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background: "#ff3366",
                            border: "3px solid #fff",
                            boxShadow: "0 0 0 4px rgba(255,51,102,0.35)",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: "50%",
                            width: size,
                            height: size,
                            transform: `translate(-50%,-50%) rotate(${angle}deg)`,
                            transformOrigin: "50% 50%",
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              left: "50%",
                              top: 2,
                              width: 0,
                              height: 0,
                              borderLeft: "6px solid transparent",
                              borderRight: "6px solid transparent",
                              borderBottom: "12px solid #fff",
                              transform: "translateX(-50%)",
                            }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              left: "50%",
                              top: "12px",
                              width: 2,
                              height: size / 2.4,
                              background: "#fff",
                              borderRadius: 2,
                              transform: "translateX(-50%)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                {(Array.isArray(floor.points) ? floor.points : []).map((p) => {
                  const pos = toPx(p.x, p.y);
                  const size = 8;
                  const isDest = dest && dest.id === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`position-absolute rounded-circle ${markerClass(
                        p.kind
                      )} ${isDest ? "border border-light" : ""}`}
                      style={{
                        left: pos.x - size / 2,
                        top: pos.y - size / 2,
                        width: size,
                        height: size,
                        cursor: "pointer",
                      }}
                      title={
                        (p.roomNumber ? `#${p.roomNumber} ` : "") +
                        (p.name || p.poiType || p.kind)
                      }
                      onClick={() => setDest({ url: selUrl, id: p.id })}
                    />
                  );
                })}

                {waypoints && waypoints.length > 0 && (
                  <div
                    className="position-absolute"
                    style={{
                      left: 0,
                      top: 0,
                      width: natSize.w,
                      height: natSize.h,
                      pointerEvents: "none",
                    }}
                  >
                    {waypoints.map((pt, idx) => {
                      const pos = toPx(pt.x, pt.y);
                      const size = 4;
                      return (
                        <div
                          key={`wp-${idx}`}
                          style={{
                            position: "absolute",
                            left: pos.x - size / 2,
                            top: pos.y - size / 2,
                            width: size,
                            height: size,
                            borderRadius: "50%",
                            background: "rgba(0,123,255,0.15)",
                          }}
                        />
                      );
                    })}
                  </div>
                )}

                {routePts && routePts.length > 1 && (
                  <svg
                    className="position-absolute"
                    width={natSize.w}
                    height={natSize.h}
                    style={{ left: 0, top: 0, pointerEvents: "none" }}
                  >
                    <polyline
                      points={routePts
                        .map((p) => `${p.x * natSize.w},${p.y * natSize.h}`)
                        .join(" ")}
                      fill="none"
                      stroke="#00D1FF"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="8 10"
                      style={{ animation: "routeDash 1.5s linear infinite" }}
                    />
                    <polyline
                      points={routePts
                        .map((p) => `${p.x * natSize.w},${p.y * natSize.h}`)
                        .join(" ")}
                      fill="none"
                      stroke="rgba(0,209,255,0.35)"
                      strokeWidth={7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="12 14"
                      style={{
                        filter: "blur(1px)",
                        animation: "routeDash 1.5s linear infinite",
                      }}
                    />
                  </svg>
                )}
              </div>
            </div>
          </div>
        )}
        {!floor && (
          <div className="text-muted">No published floors available yet.</div>
        )}
        <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={clearRoute}
            disabled={!routePts.length}
          >
            Clear
          </button>
          <button
            className={`btn btn-${autoWarp ? "info" : "outline-info"} btn-sm`}
            onClick={() => setAutoWarp((v) => !v)}
          >
            Auto warp: {autoWarp ? "On" : "Off"}
          </button>
          <button
            className={`btn btn-${
              accessibleMode ? "secondary" : "outline-secondary"
            } btn-sm`}
            onClick={() => {
              setAccessibleMode((v) => !v);
              // Clear current plan so the next route rebuild honors the mode
              setPlan(null);
              setRoutePts([]);
              waypointPtsRef.current = [];
              waypointIdxRef.current = 0;
            }}
          >
            Accessibility: {accessibleMode ? "Elevator" : "Any"}
          </button>
          <button
            className={`btn btn-${
              sensorTracking ? "danger" : "success"
            } btn-sm`}
            onClick={sensorTracking ? stopSensorTracking : startSensorTracking}
            disabled={!sensorTracking && !userPos}
          >
            {sensorTracking ? "Stop tracking" : "Start tracking"}
          </button>
          <div
            className="d-flex align-items-center small text-muted"
            style={{ gap: 8 }}
          >
            <span>Step</span>
            <input
              type="range"
              min="0.002"
              max="0.03"
              step="0.001"
              value={moveStep}
              onChange={(e) => setMoveStep(parseFloat(e.target.value) || 0.01)}
              style={{ width: 120 }}
            />
            <span>{moveStep.toFixed(3)}</span>
          </div>
          {searchMsg && <span className="small text-muted">{searchMsg}</span>}
          {routeMsg && <span className="small text-muted">{routeMsg}</span>}
        </div>
        <ShareRouteQRCode shareUrl={shareUrl} hasRoute={!!(userPos && dest)} />
        {sensorMsg && <div className="small text-muted mt-2">{sensorMsg}</div>}
        <DebuggerPanel
          visible={debugVisible}
          heading={debugData.heading}
          displayHeading={displayHeading}
          compassHeading={debugData.compassHeading}
          yaw={debugData.yaw}
          accelMagnitude={debugData.accelMagnitude}
          baselineSamples={debugData.baselineSamples}
          baselineReady={debugData.baselineReady}
          sensorMsg={debugData.sensorMsg}
          headingOffset={headingOffsetRef.current || 0}
          recording={recording}
          recordMsg={recordMsg}
        />
      </div>
    </div>
  );
}
