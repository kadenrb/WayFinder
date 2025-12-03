/*
  ===============================================
  USER MAP VIEWER (Public Landing Page Experience)
  ===============================================
  Read-only, multi-floor wayfinding viewer used by end-users.
  Key capabilities:
  - Load published floors (images + points + walkable settings)
  - Let the user set their current location ("I'm here")
  - Search for a room (supports aliases/ranges)
  - Draw a route on the current floor using the walkable color mask
  - Auto-warp between floors via stairs/elevator POIs with the same Warp Key
  - Keyboard movement with arrow keys (snaps to walkable color)

  Important: This viewer reads from localStorage (wf_public_floors). In a SaaS
  deployment, this would fetch floors.json from a hosted location on the client’s
  website.
*/
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StepDetector } from "./stepDetector";
import DebuggerPanel from "./DebuggerPanel";

// ==========================================================================
// BASIC MARKER STYLING HELPERS
// Tiny utility that turns a semantic marker kind ("door", "poi", "room")
// into the Tailwind-ish class we use to colour the pill in the UI. This is
// purely visual glue; nothing in the routing logic cares about these values.
// ==========================================================================
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

// ==========================================================================
// USERMAP ROOT COMPONENT
// This is the main public-facing map viewer. Everything that follows inside
// this function is state, refs, and helpers to keep floors, routing, sensors,
// and debug UI in sync.
//
// Rough mental model:
// - React state (`useState`) holds "truth" for anything the UI needs to render.
// - Refs (`useRef`) mirror some of that state into mutable containers that
//   non-React code can poke at (event listeners, sensor callbacks, etc.)
// - The actual heavy logic (routing, walkable checks, sensor math) lives in
//   dedicated helper sections further down; here we just wire the plumbing.
// ==========================================================================
export default function UserMap() {
  // -------------------------------------------------------------------------
  // FLOOR / ROUTING STATE
  // All the high-level map concepts live here: which floors exist, which one
  // is currently selected, where the user is, where they want to go, and what
  // route we’ve computed between those points.
  //
  // Notes:
  // - `floors` is the published manifest the admin tool generated.
  // - `selUrl` is the currently visible floor image URL.
  // - `userPos` is the user’s current position in normalized (0–1, 0–1) space.
  // - `dest` is the selected destination marker ({ url, id } combo).
  // - `routePts` is the concrete list of path points we draw on the map.
  //   We also mirror that into `routePtsRef` so non-React code can read it.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // FLOOR IMAGE CACHING
  // We keep a tiny in-memory cache of floor images and their natural sizes so
  // that “warping” between floors doesn’t force us to wait for the browser to
  // re-load each image from scratch.
  //
  // Shape:
  //   imageCacheRef.current: Map where key = floor URL,
  //   value = { img: HTMLImageElement, w: img.naturalWidth, h: img.naturalHeight }
  //
  // The routing layer only cares that, after a warp, we can immediately ask
  // “how big is this floor in pixels?” without re-doing image load work.
  // -------------------------------------------------------------------------
  const imageCacheRef = useRef(new Map()); // url -> {img, w, h}

  // -------------------------------------------------------------------------
  // STEP DETECTION / SENSOR TIMING
  // `stepDetectorRef` holds the StepDetector instance that turns accelerometer
  // noise into “a step just happened”. The other refs track how often we’re
  // sampling and when the last step was recorded, so we can throttle updates.
  //
  // - `stepSampleIntervalRef` is how often we feed data into the detector.
  // - `lastStepTsRef` is the timestamp of the last accepted step event.
  // -------------------------------------------------------------------------
  const stepDetectorRef = useRef(null);
  const stepSampleIntervalRef = useRef(50);
  const lastStepTsRef = useRef(0);

  // ========================================================================
  // SENSOR LOOP MIRRORING + FLAGS
  // From here down we start setting up the sensor side of the world. The
  // pattern you’ll see a lot is:
  //
  //   - Keep the “official” value in React state so the UI can render it.
  //   - Mirror that same value into a ref so background listeners can read
  //     it without being tied to React’s render cycle.
  //
  // This section doesn’t yet wire up the browser events; it just keeps the
  // routing/sensor bits on the same page and exposes some behavioural flags.
  // ========================================================================
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

  // -------------------------------------------------------------------------
  // DEBUG PANEL STATE
  // `debugData` is the single source of truth for the little developer
  // panel that tells us what the sensors think is going on. We keep it in a
  // single object to make it easier to dump into the UI, and `patchDebug`
  // lets us do shallow “partial updates” from all over the place without
  // constantly rebuilding the whole object by hand.
  // -------------------------------------------------------------------------
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

  // ========================================================================
  // ORIENTATION / HEADING HELPERS
  // Everything below is the “math toolbox” we use to turn whatever the
  // browser and sensors give us into a stable, human-readable heading in
  // degrees. This includes:
  //   - Dealing with different browser APIs for screen rotation.
  //   - Normalising angles into [0, 360) so we don’t keep chasing wraparound.
  //   - Coarse quantisation (snapping) so the UI doesn’t twitch like crazy.
  //   - Loading/saving a user heading offset so “north” can be calibrated.
  // ========================================================================

  // -------------------------------------------------------------------------
  // SCREEN ORIENTATION ANGLE
  // Browsers have gone through a couple of different ways of exposing the
  // current screen rotation. This helper tries them in order and falls back
  // to 0 if we can’t get anything sane.
  //
  // Returns:
  //   0, 90, 180, 270 (typically), depending on how the device is rotated.
  //   In the worst case, 0 if we’re in an environment without window/screen.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // ANGLE NORMALISATION
  // `normalizeAngle` takes any angle in degrees (negative, > 360, whatever)
  // and folds it into a clean [0, 360) range.
  //
  // Example:
  //   normalizeAngle(370)   → 10
  //   normalizeAngle(-10)   → 350
  //
  // This keeps all the downstream math from having to constantly special-case
  // “did we just wrap past 0 or 360?” every time we subtract angles.
  // -------------------------------------------------------------------------
  const normalizeAngle = (deg) => {
    let heading = deg % 360;
    if (heading < 0) heading += 360;
    if (heading >= 360) heading -= 360;
    return heading;
  };

  // -------------------------------------------------------------------------
  // HEADING QUANTISATION
  // The sensors are noisy enough that if we render the exact angle value the
  // user will see the marker shivering around even when they’re standing
  // still. `quantizeHeading` snaps the heading to the nearest 45° chunk:
  //
  //   0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°
  //
  // That gives a much calmer visual while still preserving “rough” direction.
  // -------------------------------------------------------------------------
  const quantizeHeading = (value) =>
    normalizeAngle(Math.round(value / 45) * 45);

  // -------------------------------------------------------------------------
  // HEADING OFFSET (CALIBRATION) LOAD/SAVE
  // Users can effectively say “this is north now” by setting a heading
  // offset. We store that in localStorage so the calibration survives page
  // reloads.
  //
  // - `loadHeadingOffset` reads from localStorage and normalises the value.
  // - `saveHeadingOffset` updates the ref and writes the new value back.
  //
  // The underlying data lives in `headingOffsetRef.current`, which we then
  // add on top of whatever raw heading the sensors give us via
  // `applyHeadingOffset`.
  // -------------------------------------------------------------------------
  const loadHeadingOffset = () => {
    try {
      const raw = localStorage.getItem("wf_heading_offset");
      const val = raw ? parseFloat(raw) : 0;
      if (Number.isFinite(val)) {
        headingOffsetRef.current = normalizeAngle(val);
      }
    } catch { }
  };

  const saveHeadingOffset = (val) => {
    headingOffsetRef.current = normalizeAngle(val || 0);
    try {
      localStorage.setItem(
        "wf_heading_offset",
        headingOffsetRef.current.toString()
      );
    } catch { }
  };

  useEffect(() => {
    loadHeadingOffset();
  }, []);

  const applyHeadingOffset = (val) =>
    normalizeAngle((val || 0) + (headingOffsetRef.current || 0));

  // -------------------------------------------------------------------------
  // HEADING RATE LIMITER
  // `limitHeadingRate` is there to stop the marker from instantly snapping
  // between wildly different angles just because the magnetometer had a bad
  // moment. Instead, it enforces a maximum “rotation speed” in degrees/sec.
  //
  // Inputs:
  //   - prev: the previous heading (deg) we were showing (can be null/undefined)
  //   - next: the new raw heading (deg) we got from sensors
  //
  // Internal pieces:
  //   - `headingUpdateRef.current` keeps the last accepted heading and the
  //     timestamp when we committed it.
  //   - We compute how much time has passed (dtSec) and clamp that between
  //     ~1/60 s and 0.5 s so we don’t get insane deltas from long pauses.
  //   - `maxRate` is our speed limit in deg/s. Here it’s 90°/second.
  //   - We take the shortest angular difference between prev and next
  //     (accounting for wraparound) and then clamp that difference based on
  //     `maxRate * dtSec`.
  //
  // End result:
  //   Even if the raw sensor jumps from 10° to 300° in one sample, the
  //   displayed heading will only rotate as fast as 90°/second until it
  //   catches up, which looks a lot less chaotic in the UI.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // ANGULAR DIFFERENCE IN ABSOLUTE TERMS
  // `angularDiff(a, b)` gives you “how far apart are these two headings?”
  // measured along the shortest possible arc, ignoring direction.
  //
  // Example:
  //   a = 350, b = 10 → diff = 20 (not 340)
  //
  // This is used anywhere we care about “are these headings roughly aligned?”
  // without needing to worry about clockwise vs counter-clockwise.
  // -------------------------------------------------------------------------
  const angularDiff = (a, b) => {
    let d = normalizeAngle(a - b);
    if (d > 180) d -= 360;
    return Math.abs(d);
  };

  // -------------------------------------------------------------------------
  // GEO-BASED STABLE HEADING
  // `geoStableHeading` is a sanity check derived from the geolocation API.
  // The idea is: if the user is actually moving (not standing still) and the
  // GPS heading is behaving, we can compute a “trustworthy average heading”
  // over the last few seconds.
  //
  // Data source:
  //   geoBufferRef.current: array of entries like:
  //     { ts, heading, speed, acc }
  //
  // Steps:
  //   1) Filter to only recent samples (last 5 seconds) where:
  //        - speed > 0.5 (i.e., we’re actually moving),
  //        - acc < 50   (GPS accuracy is at least vaguely acceptable).
  //   2) If we don’t have at least 3 samples, bail out with null.
  //   3) Convert each heading to a unit vector (cos/sin), sum them, and take
  //      the average direction to get a circular mean.
  //   4) Check how far each sample deviates from that mean. If any sample is
  //      more than 20° off, we call the whole thing unstable and return null.
  //
  // Returned value:
  //   - A single “best guess” heading in degrees, or
  //   - null if the data is too noisy or sparse to trust.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // GYRO “CALMNESS” CHECK
  // Not every moment is a good moment to trust the orientation sensors.
  // `gyroCalm` looks at a sliding window of recent yaw values and decides
  // whether the device has been relatively stable in the last ~2 seconds.
  //
  // Implementation details:
  //   - `yawWindowRef.current` is a list of { ts, yaw } entries.
  //   - We filter that list down to samples newer than 2 seconds.
  //   - If we have no samples, we assume “calm” (nothing has contradicted it).
  //   - Otherwise, we look at the biggest absolute yaw value in the window.
  //
  // If the maximum |yaw| in that window is < 60 degrees, we call the device
  // “calm” and return true. If it’s larger, we assume the user is in the
  // middle of a big turn or jerk and hold off on declaring things stable.
  // -------------------------------------------------------------------------
  const gyroCalm = () => {
    const now = Date.now();
    const win = (yawWindowRef.current || []).filter((e) => now - e.ts < 2000);
    yawWindowRef.current = win;

    if (!win.length) return true;

    const maxYaw = Math.max(...win.map((e) => Math.abs(e.yaw || 0)));
    return maxYaw < 60;
  };

  // -------------------------------------------------------------------------
  // ACCELEROMETER NORMALISATION
  // Raw accelerometer readings come in as x/y/z components, usually in one
  // of two units depending on the device/browser: either g (1 = gravity) or
  // m/s² (≈ 9.81 per g). This helper:
  //
  // - Accepts a loosely shaped `acc` object, safely defaulting missing axes
  //   to 0 so we don’t explode if something is undefined.
  // - Computes the magnitude of the acceleration vector:
  //       mag = sqrt(ax² + ay² + az²)
  // - If that magnitude is suspiciously large (> 3.5), we assume the values
  //   are probably in m/s² and divide by 9.81 to convert back to “g”.
  //
  // Returned shape:
  //   { ax, ay, az, mag } where mag is roughly “how many g’s is this?”
  //   which is what the StepDetector logic downstream actually cares about.
  // -------------------------------------------------------------------------
  const normalizeAccel = (acc = {}) => {
    const ax = acc.x || 0;
    const ay = acc.y || 0;
    const az = acc.z || 0;
    let mag = Math.sqrt(ax * ax + ay * ay + az * az);
    if (mag > 3.5) mag = mag / 9.81; // likely m/s^2; convert to g
    return { ax, ay, az, mag };
  };

  // -------------------------------------------------------------------------
  // HEADING SMOOTHING + DISPLAY UPDATE
  //
  // `smoothHeading(prev, next, alpha)`
  // - The sensors don’t move in nice clean steps; they jump around. This
  //   function blends the old and new headings with a simple exponential
  //   smoothing:
  //       blended = prev + alpha * (shortest_delta(prev, next))
  // - We:
  //     * Guard against non-numeric inputs and fall back to whatever sane
  //       value we do have.
  //     * Use `normalizeAngle` and a wraparound-friendly delta so that going
  //       from 350° → 10° moves by +20°, not -340°.
  // - The default alpha (0.2) means “move 20% of the way toward the new
  //   heading each update”, which dampens jitter without feeling unresponsive.
  //
  // `updateDisplayedHeading()`
  // - This is the final step before the UI sees a heading:
  //     1) Take the current raw heading from `headingRef.current`.
  //     2) Apply the user’s calibration offset via `applyHeadingOffset`.
  //     3) Subtract the screen orientation so “up” on the device matches
  //        the map’s frame of reference.
  //     4) Quantise to the nearest 45° with `quantizeHeading` so the arrow
  //        isn’t twitching constantly.
  //     5) Store the snapped heading in React state and mirror it into
  //        `debugData` for the DebuggerPanel.
  //
  // Returns:
  //   The unsnapped, normalised heading (so callers can still use the raw
  //   value if they need it for math).
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // DOM + GRID REFS
  // These refs point at the scrollable containers and image elements in the
  // DOM, plus the cached walkable grid for the currently selected floor.
  //
  // - gridRef:   holds the “walkable cells” grid for the active floor so the
  //              routing logic can check where we’re allowed to step.
  // - scrollRef: outer scroll container; used when we want to programmatically
  //              pan around the map.
  // - spacerRef: the element whose bounding box we use for pointer → map
  //              coordinate conversion.
  // - contentRef/imgRef: wrappers for directly working with the floor image.
  // - natSize:   the natural pixel size of the current image (w/h).
  //
  // None of these are directly user-facing, but if the map layout or scroll
  // behaviour is weird, this is the cluster to inspect.
  // -------------------------------------------------------------------------
  const gridRef = useRef(null); // cached walkable grid for current floor
  const scrollRef = useRef(null);
  const spacerRef = useRef(null);
  const contentRef = useRef(null);
  const imgRef = useRef(null);
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });

  // -------------------------------------------------------------------------
  // SENSOR + USER POSITION REFS
  // This is the “blackboard” layer where we keep the latest sensor-derived
  // values and a few bits of cross-floor context. These are all refs instead
  // of state so the various event listeners and async callbacks can read and
  // write them without triggering React re-renders.
  //
  // Highlights:
  // - initialFloorSetRef: guard so we only auto-pick the first floor once.
  // - headingRef / compassHeadingRef: raw vs processed heading values.
  // - userPosRef: current user position in normalised map space.
  // - geo* refs: geolocation watch ID, latest geo heading, and history buffer.
  // - yawWindowRef: recent yaw samples for “gyro calmness” checks.
  // - recordDataRef / recordStopTimerRef: recording sensor sessions for
  //   debugging or export.
  // - sensorBaselineRef / calibrationRef: baseline gravity / noise estimates
  //   used when calibrating the step detector and motion filters.
  // - stepStateRef: simple state machine for “are we in the middle of a step?”.
  // - gyroInitializedRef: one-time setup flag to avoid double-wiring handlers.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // SENSOR BASELINE INITIALISATION
  // Before we can decide what counts as “movement” or a “step”, we need a
  // baseline of what “standing still” looks like for this device. This helper
  // resets `sensorBaselineRef.current` so that the next few seconds of
  // readings can be treated as a calibration window.
  //
  // It:
  // - Picks a starting timestamp (preferring performance.now() when available
  //   for better resolution).
  // - Zeros out all the accumulated ax/ay/az sums and sample counters.
  // - Marks `ready: false` so the rest of the code knows calibration is
  //   currently in progress and shouldn’t trust the baseline yet.
  //
  // The actual accumulation and “ready” flip happen elsewhere in the sensor
  // event handlers.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // MANIFEST SOURCE
  // This is where we decide where to pull the published floors from:
  //
  // - In a “real” deployment, the client site can override the manifest URL
  //   with REACT_APP_MANIFEST_URL at build time.
  // - If that env var is missing, we fall back to the shared S3 bucket that
  //   hosts a default manifest.json for demos or testing.
  //
  // Nothing fancy here; it just centralises the URL so the fetch logic below
  // doesn’t have to care which environment it’s running in.
  // -------------------------------------------------------------------------
  const MANIFEST_URL =
    process.env.REACT_APP_MANIFEST_URL ||
    "https://wayfinder-floors.s3.us-east-2.amazonaws.com/floors/manifest.json";

  // ---------------------------------------------------------------------------
  // FLOOR LOADING
  // Fetches the published floor manifest, normalises it into the shape this
  // viewer expects, and stores the result in React state.
  //
  // Flow:
  //   1) `load()` fetches MANIFEST_URL with cache disabled so we see updates.
  //   2) On success, it parses JSON and passes `data.floors` to
  //      `normalizeFloors`.
  //   3) `normalizeFloors`:
  //        - Ensures every floor has a URL (prefers f.url, falls back to
  //          f.imageData if that’s how it was stored).
  //        - Normalises points to an array (or [] if missing).
  //        - Fills in a default `walkable` mask config if none was provided.
  //        - Assigns a stable sortOrder, falling back to the array index.
  //        - Drops any floor that doesn’t end up with a URL.
  //   4) If we get at least one valid floor, we:
  //        - Save them into `floors` state.
  //        - Call `setInitialFloor` to auto-select the first one on first load.
  //
  // The `aborted` flag and cleanup function are there to avoid state updates
  // on an unmounted component if the fetch completes after unmount.
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
  // When the user picks “I’m here” on a given floor, we stash that position
  // in localStorage under a floor-specific key:
  //   wf_user_pos:<floorUrl> → { x, y }
  //
  // This effect:
  //   - Runs whenever `selUrl` changes.
  //   - Tries to read the stored position for the newly selected floor.
  //   - Validates that it looks like a proper { x, y } object with numeric
  //     fields.
  //   - If anything is missing or broken, we just clear `userPos`.
  //
  // The follow-up effect keeps `lastUser` in sync so we remember the last
  // “known good” user position across floor changes.
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

  // ---------------------------------------------------------------------------
  // ACTIVE FLOOR + NORTH OFFSET
  // `floor` is the currently selected floor object, resolved from the list
  // of published floors using `selUrl`. If we don’t find anything, we expose
  // null so the rest of the code can short-circuit cleanly.
  //
  // Once a floor is selected, we also pull out its `northOffset` property,
  // which is the per-floor correction applied on top of whatever the device
  // thinks “north” is. If that value is missing or non-finite, we default to
  // 0 so we don’t leak NaN through the heading math.
  //
  // Note: there are two identical effects setting `northOffsetRef.current`.
  // That’s not intentional cleverness; it’s just how the code evolved. We’re
  // leaving it as-is to avoid changing behaviour.
  // ---------------------------------------------------------------------------
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


  // ==========================================================================
  // COORDINATE / GRID HELPERS
  // This section is the glue layer between “where the user clicked on screen”
  // and “where that actually is on the map”. The rest of the routing logic
  // works in a clean 0–1 normalised space, so we:
  //
  // - toNorm(clientX, clientY)
  //     Takes raw browser event coordinates (client pixels), lines them up
  //     against the map container, and returns a clamped { x, y } in [0,1].
  //
  // - toPx(x, y)
  //     Takes a normalised { x, y } and converts it back into pixel space so
  //     we can draw markers and routes in the right place on the image.
  //
  // Important: this section ONLY does unit conversion. It does not know or
  // care whether a point is walkable. Snapping to walkable cells happens in
  // `snapToWalkable` further down.
  // ==========================================================================
  const toNorm = (clientX, clientY) => {
    const el = spacerRef.current;
    const rect = el?.getBoundingClientRect();

    // -----------------------------------------------------------------------
    // SAFETY GUARD: REQUIRE A REAL ELEMENT + IMAGE SIZE
    //
    // `rect`  comes from getBoundingClientRect() on the spacer element. If the
    //         ref hasn’t been attached yet or layout isn’t ready, this will be
    //         missing and we have no idea where the map lives on screen.
    //
    // `natSize.w` / `natSize.h` are the natural pixel dimensions of the
    // currently loaded floor image. They get filled in by the image onload
    // handler. Until then, they’re 0/undefined, which is effectively “we
    // don’t know how big the map is yet”.
    //
    // The checks:
    //   !rect       → we failed to get a bounding box for the map container.
    //   !natSize.w  → width is missing or 0 (no valid image size yet).
    //   !natSize.h  → height is missing or 0.
    //
    // The OR chain means: if ANY of those are bad, we bail out early and
    // return { x: 0, y: 0 }.
    //
    // That (0,0) isn’t a “true” position, it’s just a safe default so we
    // don’t divide by zero or spray NaN through all the downstream math while
    // the DOM/image is still getting its life together.
    // -----------------------------------------------------------------------
    if (!rect || !natSize.w || !natSize.h) return { x: 0, y: 0 };

    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    const x = Math.min(1, Math.max(0, sx / natSize.w));
    const y = Math.min(1, Math.max(0, sy / natSize.h));

    return { x, y };
  };

  const toPx = (x, y) => ({
    x: x * natSize.w,
    y: y * natSize.h,
  });

  // -------------------------------------------------------------------------
  // IMAGE LOAD HANDLER
  // This runs whenever the floor image finishes loading. It has a few jobs:
  //
  //   1) Capture the natural image size into `natSize` so all coordinate math
  //      has a solid “how big is this map?” reference.
  //
  //   2) Cache that image + size in `imageCacheRef` keyed by `selUrl`, so
  //      when we warp between floors we can re-use the dimensions immediately
  //      instead of waiting for the browser to rediscover naturalWidth/Height.
  //
  //   3) Build or update the “walkable grid” for this floor by:
  //        - Looking up the floor’s `walkable.color` and any extraColors.
  //        - Converting those hex colours into RGB.
  //        - Calling `buildGrid(image, colors, tolerance, step)` which scans
  //          the bitmap and produces a coarse grid of walkable cells.
  //        - Stashing the result in `gridRef.current` so the routing code can
  //          query “is this position walkable?” without re-reading pixels.
  //
  //   4) If we previously deferred routing because we had to switch floors
  //      (and therefore needed this image to load first), we call the stored
  //      `routeResumeRef.current` callback now that everything is ready.
  //
  // If building the grid fails for any reason, we just set `gridRef.current`
  // to null and the pathfinding code will gracefully fall back to “no grid”.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // USER POSITION STORAGE
  // Small helper that remembers the user’s position for a given floor in
  // localStorage under the key:
  //   wf_user_pos:<url> → { x, y }
  //
  // This is called whenever we want to “commit” a new “I’m here” location so
  // that, on reload, the user can be dropped roughly where they left off.
  // Any errors (e.g. private browsing or storage limits) are silently ignored.
  // -------------------------------------------------------------------------
  const saveUserPos = (url, p) => {
    try {
      localStorage.setItem(`wf_user_pos:${url || ""}`, JSON.stringify(p));
    } catch { }
  };

  // -------------------------------------------------------------------------
  // SNAP TO NEAREST WALKABLE CELL
  // Given a normalised coordinate (nx, ny), this tries to pull the position
  // onto the nearest walkable cell centre in the cached grid for the current
  // floor. If anything is missing (no grid, no image, no floor), we just
  // return the original coordinate unchanged.
  //
  // Flow:
  //   1) Grab the current grid (`gridRef.current`) and active floor.
  //   2) `g` has:
  //        - grid: flat array of walkable flags,
  //        - gw, gh: grid width/height in cells,
  //        - step:   how many image pixels per grid cell,
  //        - w, h:   underlying image size.
  //   3) Convert our normalised (nx, ny) into an approximate grid cell index:
  //        cx ≈ (nx * w) / step
  //        cy ≈ (ny * h) / step
  //      and clamp those to [0, gw-1] / [0, gh-1].
  //   4) Ask `nearestWalkable(grid, gw, gh, cx, cy)` to find the closest
  //      walkable cell from that starting point.
  //   5) If we get one back, convert that cell centre back into normalised
  //      coordinates:
  //        cell centre pixel = (index * step + step/2)
  //        normalised = centre / image dimension
  //
  // This is what gives the “magnetic” snapping feeling when placing the user
  // or nudging with keys: even if you click slightly off the drawn corridor,
  // the position will slide onto the nearest walkable lane.
  // -------------------------------------------------------------------------
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

  // ========================================================================
  // ROOM SEARCH HELPERS
  // The next few helpers are the text-mangling side of room search. The goal
  // is to let users type things like “B203”, “B200-B210”, or aliases and have
  // us find a matching point across all floors.
  //
  // Pieces:
  //   - normCode:   normalises human input into a canonical “no spaces, upper
  //                 case, ASCII hyphens” format.
  //   - parseCode:  splits something like "B203" into { prefix: "B", num: 203 }.
  //   - parseRange: understands simple ranges like "B200-B210".
  //   - matchesPointCode: checks a single point’s roomNumber + aliases
  //                       against a query, including ranges.
  //   - searchRoom: walks all floors/points looking for the first match and
  //                 sets `dest` + `selUrl` accordingly.
  // ========================================================================
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

      // Alias is a range like "B200-B210"
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
        // Simple alias, direct match
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
          `Destination set: ${hit.roomNumber || hit.name || hit.poiType || hit.kind
          }`
        );
        return;
      }
    }

    setSearchMsg("No matching room found");
  };

  // -------------------------------------------------------------------------
  // MOTION / ORIENTATION PERMISSIONS (MOBILE)
  // On modern iOS and some browsers, access to DeviceMotion/DeviceOrientation
  // is gated behind an explicit permission prompt. This helper centralises
  // that dance:
  //
  // - If DeviceMotionEvent.requestPermission exists, we call it and require
  //   "granted" before proceeding.
  // - Same thing for DeviceOrientationEvent.requestPermission.
  //
  // If either one is denied, we throw an error so the caller can show a
  // sensible message and bail out of sensor-based features cleanly.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // START SENSOR TRACKING
  // This is the “on” switch for live tracking. It validates preconditions,
  // requests permissions, resets calibration, wires up geolocation hints, and
  // tells the rest of the app “we’re now in sensor-tracking mode”.
  //
  // High-level flow:
  //
  //   1) Guard against missing user position:
  //        - If we don’t know where the user is on the map yet, there’s no
  //          point in moving a marker around. We show a message and bail.
  //
  //   2) Guard against missing APIs:
  //        - If the environment doesn’t expose DeviceMotionEvent at all,
  //          we say so and exit.
  //
  //   3) Ask for motion/orientation permissions via requestMotionPermissions.
  //
  //   4) Reset calibration + step detector state:
  //        - `calibrationRef` gets a fresh baseline state.
  //        - `stepStateRef` gets a fresh timestamp and `active: false`.
  //        - `gyroInitializedRef` is reset so we know to re-wire any gyro
  //          event listeners as needed.
  //        - `initSensorBaseline()` clears the “standing still” baseline so
  //          the next few seconds of readings can re-calibrate.
  //
  //   5) Seed `headingRef.current` with either the last compass heading or
  //      whatever we had before, then call `updateDisplayedHeading()` so the
  //      UI starts from a sane angle.
  //
  //   6) Start an optional geolocation watcher:
  //        - If navigator.geolocation is available and we don’t already have
  //          a watch running, we call watchPosition.
  //        - For each reading with a valid heading (0–360), we:
  //            * Build an entry { heading, speed, acc, ts }.
  //            * Store it as the latest geoHeadingRef.
  //            * Push it into geoBufferRef, keeping only recent samples (last
  //              few seconds / last ~20 entries).
  //          These are later used by geoStableHeading() as a sanity check.
  //
  //   7) Flip `sensorTracking` on and show a “Calibrating sensors. Hold still…”
  //      message both in UI and debug panel.
  //
  // Errors:
  //   - Any permission failure or exception will drop into the catch block,
  //     update the message accordingly, and leave `sensorTracking` false.
  // -------------------------------------------------------------------------
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
          () => { },
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

  // -------------------------------------------------------------------------
  // STOP SENSOR TRACKING
  // This is the “off switch” for live tracking. It does more than just flip
  // a boolean; the idea is that when you hit stop, the *next* session should
  // start from a clean slate, not half-remembered calibration from last time.
  //
  // What it actually does:
  //   - Turns off sensorTracking and updates the user-facing message.
  //   - If we have a geolocation watch running, it cancels it and clears out
  //     any stored geo heading.
  //   - Resets calibration and step state back to default “not calibrated /
  //     not stepping”.
  //   - Wipes the sensor baseline so the next call to startSensorTracking can
  //     re-learn what “standing still” looks like.
  //   - Resets a bunch of debug values (baselineSamples, accelMagnitude, yaw,
  //     etc.) so the debug panel doesn’t show stale numbers.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // SENSOR RECORDING HELPERS
  // This set of helpers is purely for debugging / data capture. It lets you
  // record a window of sensor data plus some context (time, floor, user
  // position), and optionally download it as JSON so you can analyse it
  // offline.
  //
  // - stopRecording(download = true)
  //     Cancels any pending auto-stop timer, flips `recording` off, and:
  //       * If `download` is true and we have samples, builds a JSON blob,
  //         triggers a one-off “invisible” download, and revokes the URL
  //         shortly after.
  //       * Otherwise, just updates the recordMsg with how many samples we
  //         captured.
  //
  // - startRecording()
  //     Normalises the requested duration into [1, 120] seconds, clears the
  //     current sample buffer, notes the starting user position, flips the
  //     recording flag, and sets up a timeout to auto-stop (with download)
  //     when the time window expires.
  //
  // - logSample(sample, force = false)
  //     Appends a new sample into `recordDataRef.current` along with:
  //       * t:   current timestamp
  //       * url: current floor URL
  //       * userPos: whatever the latest user position is
  //       * ...sample: whatever the caller provided (sensor readings, etc.)
  //     If we’re not currently recording and `force` is false, it does
  //     nothing. `force` is basically “log this one even if recording is off”.
  //
  // There’s also a tiny effect that makes sure we stop recording (without
  // auto-download) if the component unmounts mid-recording, so we don’t leave
  // timers and refs hanging around.
  // -------------------------------------------------------------------------
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

  // Cleanup-on-unmount: if we navigate away or this component unmounts while
  // recording, we stop gracefully *without* forcing a download popup.
  useEffect(() => () => stopRecording(false), []);

  // ---------------------------------------------------------------------------
  // DESKTOP SPOOFED MOVEMENT
  // Arrow keys move the marker for testing without a phone.
  //
  // This is the “I don’t have a physical device handy” mode. Instead of
  // waiting on real accelerometer data, we treat the arrow keys as small
  // nudges in normalised space:
  //
  //   - Left/Right adjust x by ±moveStep
  //   - Up/Down   adjust y by ±moveStep
  //
  // The workflow:
  //   1) Ignore keypresses unless we already have a userPos (you have to
  //      place yourself on the map once first).
  //   2) Apply the delta, clamp to [0,1] so we don’t fall off the map.
  //   3) Run the result through `snapToWalkable` so it still honours the
  //      walkable mask.
  //   4) Update state and persist the new position with saveUserPos().
  //
  // This entire effect is wired once and cleaned up on unmount.
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

  // ---------------------------------------------------------------------------
  // DEVICEMOTION → STEP DETECTOR WIRING
  // This effect hooks the browser's `devicemotion` event into the StepDetector
  // and then into our waypoint-stepping logic.
  //
  // Rough flow:
  //   1) If we're not in a browser with DeviceMotionEvent, we bail out.
  //   2) Create a StepDetector instance with:
  //        - sampleIntervalMs: initial guess based on stepSampleIntervalRef
  //        - windowMs: how much history to consider for detection (2s)
  //   3) In the handler:
  //        - Pull acceleration (preferring accelerationIncludingGravity).
  //        - On first events, if event.interval exists and we haven't set up
  //          the sample interval yet, we:
  //              * Clamp interval to a sane range (>= 10ms)
  //              * Update stepSampleIntervalRef.current
  //              * Ask the StepDetector to update to that interval too.
  //              * Mark the “we initialised this once” flag by hanging an
  //                ad-hoc property on stepSampleIntervalRef.
  //        - Feed ax/ay/az into the StepDetector.
  //        - If it reports a step, we:
  //              * Check the time since last accepted step (min. 400ms
  //                between steps to avoid double-triggering on noise).
  //              * Update lastStepTsRef and call stepWaypoint() to move
  //                along the current route plan.
  //
  // The cleanup removes the devicemotion listener when the component unmounts
  // or when stepWaypoint's identity changes.
  // ---------------------------------------------------------------------------
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

      // Some platforms report an `interval` (ms between sensor samples).
      // We lazily use the first one we see to fine-tune the StepDetector’s
      // expected interval, and stash an “initialised” flag on the ref object
      // so we only do this once.
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

  // ---------------------------------------------------------------------------
  // ROUTING COLOR / GRID HELPERS
  // These helpers are the low-level tools that turn a coloured “walkable”
  // overlay into an actual grid the routing code can navigate.
  //
  // The chain looks like this:
  //
  //   1) normHex / hexToRgb
  //        Take whatever colour config the floor has (e.g. "#9f9383",
  //        "9F9", " 9f9383 ") and turn it into a clean [r, g, b] triplet.
  //
  //   2) buildGrid(imgEl, colors, tol, step)
  //        Sample the image at regular intervals and mark each sample as
  //        walkable (1) or not (0) depending on how close the pixel colour
  //        is to one of our target colours.
  //
  //   3) nearestWalkable(...)
  //        Given a grid cell index, do a simple breadth-first search outward
  //        to find the closest cell that is walkable. Used for snapping.
  //
  //   4) bfs(...)
  //        Run a BFS across the grid from a start cell to a target cell,
  //        optionally allowing small “gaps” where we can hop over a short
  //        non-walkable run (e.g. tiny imperfections in the mask).
  //
  // All of this operates on a coarser grid than the actual image (step > 1),
  // so we don’t pay full-pixel costs for pathfinding.
  // ---------------------------------------------------------------------------

  // Normalise a hex colour string into a strict "#RRGGBB" form. We accept:
  //   - "#abc"   → expand to "#aabbcc"
  //   - "abc"    → treat as "#abc" then expand
  //   - "#A1B2C3" (already fine) → stay as-is
  // Anything that doesn't match a valid 6-digit hex code after this dance
  // falls back to pure black "#000000" so the rest of the code has something
  // predictable to work with.
  const normHex = (s) => {
    if (!s) return "#000000";
    let t = s.toString().trim().toUpperCase();
    if (!t.startsWith("#")) t = "#" + t;
    if (t.length === 4) t = "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    return /^#[0-9A-F]{6}$/.test(t) ? t : "#000000";
  };

  // Convert a hex colour string into an [r, g, b] array of numbers (0–255),
  // using normHex for safety so we don't have to worry about shorthand or
  // casing. This is the format buildGrid expects for the `colors` argument.
  const hexToRgb = (hex) => {
    const h = normHex(hex);
    return [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
  };

  // ---------------------------------------------------------------------------
  // BUILD WALKABLE GRID FROM IMAGE
  // `buildGrid(imgEl, colors, tol, step = 4)` scans the floor image and
  // builds a coarse grid where each cell is either:
  //   - 1 → treat as walkable
  //   - 0 → treat as blocked
  //
  // Inputs:
  //   - imgEl:  <img> element showing the floor map.
  //   - colors: array of target colours [[r,g,b], ...] that represent
  //             walkable areas (main mask colour + any extra colours).
  //   - tol:    tolerance (0–255) for colour distance. Higher = more lenient
  //             matching, so slightly different shades still count as walkable.
  //   - step:   how many pixels we skip between samples in each direction.
  //             Larger step → fewer grid cells and faster routing, but lower
  //             resolution. Default is 4 pixels per grid cell.
  //
  // How it works:
  //   1) Draw the image onto an off-screen canvas.
  //   2) Read back the raw RGBA pixel data.
  //   3) Compute how many grid cells we get in X/Y:
  //        gw = floor(w / step), gh = floor(h / step)
  //   4) For each grid cell (gx, gy):
  //        - Pick the pixel roughly in the centre of that cell.
  //        - Compare its (r,g,b) to each target colour.
  //        - Euclidean distance in RGB space decides if we're within tol:
  //              dist = sqrt((r-tr)² + (g-tg)² + (b-tb)²)
  //        - If any target colour matches (dist <= tol), mark grid[cell] = 1,
  //          otherwise 0.
  //
  // Returned object:
  //   { grid, gw, gh, step, w, h }
  //   - grid: Uint8Array of length gw * gh (0/1 flags).
  //   - gw, gh: grid dimensions in cells.
  //   - step:   the sampling step we used (pixels per cell).
  //   - w, h:   backing image dimensions in pixels.
  //
  // Note: this is async mostly for future flexibility; in practice it runs
  // synchronously today.
  // ---------------------------------------------------------------------------
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

        // Compare this pixel against all configured walkable colours.
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

  // ---------------------------------------------------------------------------
  // NEAREST WALKABLE CELL (LOCAL SNAP)
  // `nearestWalkable(grid, gw, gh, sx, sy)` takes a starting grid coordinate
  // and tries to find the closest cell that is marked walkable (grid[...] = 1).
  //
  // Behaviour:
  //   - If the starting cell is already walkable, we return it immediately.
  //   - Otherwise, we breadth-first search outward in 8 directions
  //     (4 cardinal + 4 diagonal).
  //   - `inb(x, y)` is just a quick in-bounds check to keep lookups safe.
  //   - `seen` stops us from revisiting the same cell over and over.
  //   - As soon as we find a walkable cell, we return its [x, y] indices.
  //   - If the queue empties with no walkable cells found, we return null.
  //
  // This is used in things like snapToWalkable() to give that “magnetic”
  // behaviour when placing or nudging the user: it pulls them onto the
  // nearest corridor instead of leaving them floating in unwalkable space.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // BREADTH-FIRST SEARCH (PATHFINDING)
  // `bfs(grid, gw, gh, s, t, gap = 0)` tries to find a walkable path from
  // start cell `s` to target cell `t` across the 2D grid.
  //
  // Parameters:
  //   - grid: Uint8Array of walkable flags (1 = walkable, 0 = blocked).
  //   - gw, gh: grid width/height.
  //   - s: [sx, sy] start cell indices.
  //   - t: [tx, ty] target cell indices.
  //   - gap: how forgiving we are about tiny breaks in the mask:
  //       - 0  → strictly require every step to land on a walkable cell.
  //       - >0 → allow “jumping” over up to `gap` blocked cells in a straight
  //              line if there is a walkable cell a little further along
  //              that direction. This helps bridge small mask gaps caused by
  //              imperfect drawing or compression artifacts.
  //
  // Internals:
  //   - `prev` tracks where we came from for each visited cell (as a flat
  //     index). This is used to reconstruct the path backwards from the
  //     target at the end.
  //   - `seen` marks which cells we’ve already enqueued so we don’t loop.
  //   - `dirs` is the 8-direction neighbour list (same as nearestWalkable).
  //   - We work with flat indices (idx = y * gw + x) for efficient arrays.
  //
  // Algorithm:
  //   1) Convert s and t to flat indices (sIdx, tIdx).
  //   2) BFS from sIdx:
  //        - For each current cell, visit neighbours in all 8 directions.
  //        - If neighbour cell is walkable, consider it directly.
  //        - If neighbour is not walkable but gap > 0, we look ahead up to
  //          `gap` additional cells along that direction to see if there is
  //          a walkable cell we can “jump” to. First one found becomes tgt.
  //        - If we get a valid tgt that isn't already seen, we:
  //            * mark seen[tgt] = 1
  //            * set prev[tgt] = cur
  //            * enqueue tgt
  //        - We stop early if we reach tIdx.
  //   3) If we never set prev[tIdx] (and sIdx !== tIdx), there is no path.
  //      Return null.
  //   4) Otherwise, walk backwards from tIdx via prev[] to reconstruct the
  //      path into an array of [x, y] cells, then reverse it so it’s start →
  //      target.
  //
  // The returned path can then be converted back into normalised coordinates
  // for drawing and driving the step-based movement.
  // ---------------------------------------------------------------------------
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

        if (grid[nIdx]) {
          tgt = nIdx;
        } else if (gap > 0) {
          // Try to “look ahead” a few cells in the same direction to see if
          // there is a walkable cell just past a small blocked stretch.
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


  // ---------------------------------------------------------------------------
  // WAYPOINT GENERATION ALONG A ROUTE
  // `buildWaypoints(pts, spacingNorm)` takes a polyline in normalised space
  // (an ordered list of { x, y } points) and builds a new list of points that
  // are spaced more evenly along the route.
  //
  // Why this exists:
  //   - The BFS/grid routing gives us a jagged set of points that correspond
  //     to grid cells, not nice “every X metres” step intervals.
  //   - For step-based movement, we want something closer to “move one unit”
  //     per detected step, not “jump unevenly depending on original spacing”.
  //
  // How it works:
  //   - `spacingNorm` is the desired spacing in normalised units, defaulting
  //     to roughly 1/700 of the map (tuned by trial).
  //   - We walk each segment [a → b]:
  //       * Measure its length in normalised coords (segLen).
  //       * Use `acc` to remember leftover distance from the previous segment
  //         so we keep spacing consistent across segment boundaries.
  //       * While we still have room for another waypoint on that segment,
  //         we compute `ratio = t / segLen` and linearly interpolate:
  //             x = a.x + (b.x - a.x) * ratio
  //             y = a.y + (b.y - a.y) * ratio
  //       * After we’re done with this segment, update `acc` to whatever
  //         “partial step” remains after placing as many whole steps as fit.
  //   - At the end we make sure the final route point is included, even if it
  //     doesn’t land exactly on a spacing boundary.
  //
  // End result:
  //   A smooth list of waypoints that are evenly spaced along the original
  //   path, which feels much better to walk through step-by-step.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // ROUTE SIMPLIFICATION (RDP + ANGLE COLLAPSE)
  // `simplifyRoute(pts, epsilon)` takes the raw route polyline and tries to
  // remove unnecessary points that just add noise without changing the shape.
  //
  // Two-stage cleanup:
  //
  //   1) Ramer-Douglas-Peucker (RDP):
  //        - This is a classic line simplification algorithm.
  //        - It looks at a segment from the first to the last point and finds
  //          the point in between with the largest distance from that segment.
  //        - If that max distance is <= epsilon, we throw away all the
  //          intermediate points and keep just [start, end].
  //        - Otherwise, we recursively apply the same logic to the left and
  //          right sub-chains.
  //        - The helper `distSqToSegment` does the squared-distance math from
  //          a point to the infinite segment [a, b], clamped to the segment
  //          extents.
  //
  //   2) Colinear collapse:
  //        - Even after RDP, we might still have points that are almost on a
  //          straight line. We walk the simplified list and for each triple
  //          (a, b, c) we compute the angle at b.
  //        - If that angle is very small (here less than ~5 degrees), b is
  //          essentially on a straight line between a and c, so we skip it.
  //        - Otherwise, we keep b.
  //
  // Why epsilon is in normalised units:
  //   - The whole route is in 0–1 coordinate space, so epsilon ≈ 0.003
  //     roughly means “ignore deviations smaller than about 0.3% of the map”.
  //
  // Returned value:
  //   - A shorter array of { x, y } points that approximates the original
  //     path but with far fewer tiny zig-zags from the grid.
  // ---------------------------------------------------------------------------
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
      const abx = b.x - a.x,
        aby = b.y - a.y;
      const bcx = c.x - b.x,
        bcy = c.y - b.y;
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

  // ---------------------------------------------------------------------------
  // ROUTE DIRECTION + HEADING (PLACEHOLDER + HOOK)
  // `routeDirection` is currently a stub; it exists as a hook for future
  // logic that might expose a higher-level “go north / go east” instruction
  // separate from the raw heading degrees. Right now it deliberately returns
  // null and is never used in calculations.
  //
  // `routeHeadingDeg` is the source of truth for “what heading should we show
  // when we’re locked to the route?”. In the current design, route-locked
  // mode updates the heading when we step along waypoints, and this just
  // returns the latest stored headingRef (or 0 as a fallback).
  // ---------------------------------------------------------------------------
  const routeDirection = () => {
    return null;
  };

  const routeHeadingDeg = () => {
    // Route-locked mode uses waypoint progression; heading is updated when stepping.
    return headingRef.current || 0;
  };

  // ---------------------------------------------------------------------------
  // WAYPOINT STEPPING (ONE STEP = N WAYPOINTS)
  // `waypointStride` controls how many waypoints we advance per “step”.
  // This is a tuning knob:
  //   - 1 → very fine-grained movement (more steps to finish a route).
  //   - 2 → slightly bigger jumps (fewer steps, faster progression).
  //
  // `stepWaypoint()` is what gets called whenever we detect a physical step
  // (via sensors) or a simulated step (e.g. desktop test triggers). It:
  //
  //   1) Figures out which waypoint list to use:
  //        - Prefers `waypointPtsRef.current` if populated
  //        - Falls back to `waypoints` state otherwise
  //      If there’s nothing, we complain that no route is available.
  //
  //   2) Reads our current waypoint index from `waypointIdxRef.current`,
  //      defaulting to 0 and clamping into valid range just in case.
  //
  //   3) Advances the index by `waypointStride`, but never past the final
  //      waypoint. This is the “move one step forward along the route” part.
  //
  //   4) Updates:
  //        - waypointIdxRef.current with the new index
  //        - userPos state with the new target waypoint
  //        - persisted user position via saveUserPos(selUrl, target)
  //        - userPosRef.current for sensor-side code
  //
  //   5) Recomputes the heading based on the movement from previous userPos
  //      to this new waypoint:
  //        - dx = target.x - oldX
  //        - dy = target.y - oldY
  //        - headingDeg = atan2(dx, -dy) converted to degrees, then normalised
  //      Note the swapped parameters in atan2(dx, -dy): this is because the
  //      map is using a screen-style coordinate system (y grows downward),
  //      and we want “up” on the map to align with 0°.
  //
  //   6) Quantises the heading to the same coarse buckets as elsewhere and
  //      pushes it into `displayHeading` so the arrow rotates to match the
  //      direction of travel.
  //
  //   7) Logs a console message and sets a user-facing sensorMsg describing
  //      which waypoint we’re now on.
  //
  // If we don’t have an active route, we do nothing except update sensorMsg
  // to remind the user they need to build a route first.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // CROSS-FLOOR PLAN BUILDING (WARP KEYS)
  //
  // This section is all about figuring out *how to get from one floor to
  // another* using shared warp keys (stairs / elevators that are logically
  // linked between floors).
  //
  // Concepts:
  //   - Every stairs/elevator POI can have a `warpKey` string. If two floors
  //     both have a POI with the same warpKey, we treat that as “these floors
  //     connect here”.
  //
  //   - normalizeKey(k)
  //       Makes warp keys safe/comparable by lowercasing and trimming.
  //
  //   - sharedWarpKeys(a, b)
  //       Given two floor objects, looks through their POIs and returns a list
  //       of warpKey strings that exist on *both* floors.
  //
  //   - makePlan(fromUrl, toUrl)
  //       Builds a *floor-level* path (not per-pixel routing) from one floor to
  //       another by:
  //         1) Treating each floor URL as a node in a graph.
  //         2) Drawing edges between floors that share at least one warpKey.
  //         3) Running a simple BFS over that graph to find a chain of floors
  //            from `fromUrl` to `toUrl`.
  //         4) Returning that as an array of steps:
  //              [{ url, kind: "warp" | "dest" }, ...]
  //
  // If there is no shared warp path between the floors, we fall back to
  // “single-floor” behaviour: just return [{ url: fromUrl, kind: "dest" }].
  // ---------------------------------------------------------------------------
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
    // Trivial case: same floor or missing endpoints → one-step “dest” plan.
    if (!fromUrl || !toUrl || fromUrl === toUrl)
      return [{ url: fromUrl, kind: "dest" }];

    const urls = floors.map((f) => f.url);

    // `prev` is the standard BFS breadcrumb map:
    //   floorUrl → previous floorUrl in the chain (or null for the start).
    const prev = new Map([[fromUrl, null]]);
    const q = [fromUrl];

    // Precompute, for each floor URL, the set of warp keys present on that floor.
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

    // BFS over floor URLs: connect floors that share at least one warp key.
    while (q.length) {
      const u = q.shift();
      if (u === toUrl) break;
      for (const v of urls) {
        if (prev.has(v) || v === u) continue;

        const A = keysByUrl.get(u) || new Set();
        const B = keysByUrl.get(v) || new Set();
        let ok = false;

        // Look for any shared warp key between floor u and floor v.
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

    // If we never reached toUrl, there is no cross-floor path.
    if (!prev.has(toUrl)) return [{ url: fromUrl, kind: "dest" }];

    // Reconstruct the floor chain from toUrl back to fromUrl via `prev`.
    const chain = [];
    for (let at = toUrl; at; at = prev.get(at)) chain.push(at);
    chain.reverse();

    // Mark the last step as "dest" and all previous ones as "warp".
    return chain.map((u, i) => ({
      url: u,
      kind: i === chain.length - 1 ? "dest" : "warp",
    }));
  };

  // ---------------------------------------------------------------------------
  // ROUTE COMPUTATION FOR A SINGLE PLAN STEP
  //
  // `computeRouteForStep(step, startPosOverride, planArg, fallbackUsed, gapOverride)`
  //
  // This is the heavy lifter for “draw me a route on the *current* floor”.
  // It does not worry about the full multi-floor story; it focuses on:
  //
  //   - Taking a `step` that says either “go to the destination room on this
  //     floor” (kind: "dest") or “go to a matching warp (stairs/elevator) that
  //     links to the next floor” (kind: "warp").
  //
  //   - Building/using a colour-based walkable grid for the active floor.
  //
  //   - Snapping both the start position and target to the nearest walkable
  //     grid cells.
  //
  //   - Running BFS to get a grid path.
  //
  //   - (Further down in this function, outside the snippet you pasted, that
  //     grid path is turned into normalised coordinates, simplified, converted
  //     into waypoints, etc.)
  //
  // Parameters:
  //   - step:
  //       { url, kind: "warp" | "dest" }
  //       A single entry from the `plan.steps` array.
  //
  //   - startPosOverride:
  //       Optional { x, y } normalised coords. If provided, routing starts
  //       from here instead of the current userPos. Handy after warps.
  //
  //   - planArg:
  //       Optional plan object if we need to inspect `plan.steps` while
  //       routing (e.g. to know the “next floor” when choosing a warp).
  //
  //   - fallbackUsed / gapOverride:
  //       Flags/tuning knobs for “second chance” routing when the first pass
  //       fails because of small holes in the mask. (Used later in this
  //       function when we adjust BFS gap behaviour.)
  // ---------------------------------------------------------------------------
  const computeRouteForStep = async (
    step,
    startPosOverride = null,
    planArg = null,
    fallbackUsed = false,
    gapOverride = null
  ) => {
    const curFloor = floors.find(f => f.url === selUrl);
    if (!curFloor) return;

    const img = imgRef.current;
    if (!img || !img.naturalWidth) {
      setSensorMsg("Image not ready for routing.");
      return;
    }

    // Walkable colour configuration:
    //   - baseColors: the main mask colour for this floor.
    //   - extraColors: optional additional mask colours (e.g. multi-colour
    //     corridors) normalised via normHex → hexToRgb.
    const baseColors = [hexToRgb(curFloor.walkable?.color || "#9F9383")];
    const extraColors = Array.isArray(curFloor.walkable?.extraColors)
      ? curFloor.walkable.extraColors.map((c) => hexToRgb(normHex(c)))
      : [];
    const tol = curFloor.walkable?.tolerance;

    // Helper that actually invokes buildGrid with or without the extra colours.
    const buildGridTry = async (useExtra) => {
      const cols = useExtra ? baseColors.concat(extraColors) : baseColors;
      return buildGrid(img, cols, tol, 4);
    };

    // Wraps grid build + “figure out our starting grid cell”.
    // Returns both the grid object and the snapped start cell (sCell).
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

    // First attempt: only the base walkable colour.
    let attempt = await tryBuild(false);

    // If we couldn't find a walkable start cell *and* we have extra colours,
    // retry including the extra colours in the grid building.
    if (!attempt.sCell && extraColors.length) {
      attempt = await tryBuild(true);
    }

    // Still no valid start cell? We give up on this route.
    if (!attempt.sCell) {
      setRoutePts([]);
      return;
    }

    const { obj: gridObj, sCell, w, h, stp, gw, gh } = attempt;

    let target = null;

    if (step.kind === "dest") {
      // Destination step:
      //   Find the floor that actually owns the destination point (dest.id),
      //   and only accept it if that floor matches the currently selected URL.
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
      // ---------------------------------------------------------------------
      // WARP STEP: PICK NEAREST VALID STAIRS/ELEVATOR
      //
      // When step.kind === "warp", we’re not trying to hit the final room
      // yet. We’re trying to move the user to the correct stairs/elevator
      // that will connect this floor to the *next* floor in the plan.
      //
      // Strategy:
      //   1) Look at the next plan step (plan.steps[index + 1]) to grab its
      //      URL. That’s our “other side” floor.
      //   2) Compute the shared warp keys between this floor and that floor.
      //   3) Filter current floor points down to just those POIs that:
      //         - are stairs or elevator
      //         - have a warpKey
      //         - that warpKey is one of the shared ones from step 2
      //   4) If accessibleMode is on, prefer elevators. If there are any
      //      elevators in the candidates list, we only consider those.
      //   5) Later (in the remaining part of this function), we’ll pick the
      //      nearest candidate to the user and route toward it.
      // ---------------------------------------------------------------------
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

      // (The remaining logic in this function — picking the nearest candidate,
      // running BFS, handling gapOverride/fallbackUsed, building final route
      // points — continues after this snippet. We’re leaving the code itself
      // untouched and just documenting what’s here.)
    }

    // ---------------------------------------------------------------------------
  // WARP TARGET SELECTION + GRID ROUTE BUILD
  //
  // We’re in the middle of `computeRouteForStep` here, specifically the
  // “warp step” branch where we already:
  //   - Found a pool of candidate stairs/elevators on the current floor that
  //     share warp keys with the next floor.
  //   - Built a walkable grid and located:
  //       * sCell → the starting walkable cell near the user
  //       * gw, gh, stp, w, h → grid/image parameters
  //
  // This block does three big jobs:
  //
  //   1) Pick the *best* warp pair across floors:
  //        - Prefer the warp whose counterpart on the NEXT floor is closest
  //          to the final destination room.
  //        - If multiple warps tie, break the tie using “closest to user”.
  //
  //   2) Convert both the chosen warp target and the destination (warp or
  //      room) into walkable grid cells and run BFS to get a path.
  //
  //   3) Turn that BFS path into:
  //        - Normalised coordinates (0–1)
  //        - A simplified route (remove zig-zags)
  //        - A set of waypoints and waypoint index reset (if it’s the first
  //          time building this route)
  //
  // There’s also a gap / fallback mechanism:
  //   - gapVal controls how much “hole jumping” BFS is allowed to do.
  //   - If a strict gap=0 run fails and we haven’t tried fallback yet, we
  //     recursively re-call computeRouteForStep with gapOverride=1. This lets
  //     us gracefully handle small mask imperfections without going wild.
  // ---------------------------------------------------------------------------

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

      // For this candidate warp key, measure how close its counterparts on
      // the next floor are to the destination room.
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

  // Now that we know which warp key best lines up with the destination,
  // pick the actual POI instance on THIS floor that:
  //   - Uses that warp key (if bestKey exists), and
  //   - Is closest to the current user position.
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

  // Store current warp target on step for later proximity checks. This
  // lets us know “we’re at the correct stairs/elevator” during autowarp.
  step.key = normalizeKey(best.warpKey);
  step.target = target;
}

// -----------------------------------------------------------------------
// GRID TARGET CELL + BFS PATH
//
// At this point:
//   - sCell: starting grid cell (walkable, near user).
//   - target: a { x, y } normalised target (room or warp POI).
//   - gridObj: { grid, gw, gh, step: stp, w, h } from buildGrid.
//
// We now:
//   1) Convert target from normalised coords → grid cell indices (tx, ty).
//   2) Snap (tx, ty) to the nearest walkable cell via nearestWalkable.
//   3) Run BFS to get a path from sCell → tCell, honouring `gapVal`.
//   4) If BFS fails and we haven’t tried a gap-based fallback yet,
//      recall computeRouteForStep with gapOverride=1.
// -----------------------------------------------------------------------
const tx = Math.max(0, Math.min(gw - 1, Math.round((target.x * w) / stp)));
const ty = Math.max(0, Math.min(gh - 1, Math.round((target.y * h) / stp)));
const tCell = nearestWalkable(gridObj.grid, gw, gh, tx, ty);

if (!tCell) {
  setRoutePts([]);
  return;
}

const gapVal = Math.max(0, Math.floor(gapOverride ?? gapCells ?? 0));
const path = bfs(gridObj.grid, gw, gh, sCell, tCell, gapVal);

if (!path || path.length < 2) {
  // If we failed with a strict (gap=0) pass and haven’t used fallback yet,
  // try once more with a tiny gap to hop over micro-holes in the mask.
  if (!fallbackUsed && gapVal === 0) {
    await computeRouteForStep(step, startPosOverride, planArg, true, 1);
  } else {
    setRoutePts([]);
  }
  return;
}

// -----------------------------------------------------------------------
// PATH → NORMALISED POINTS → SIMPLIFIED ROUTE
//
// Convert grid cell indices back into normalised 0–1 coordinates by using
// the centre of each cell:
//   centreX_px = gx * stp + stp/2
//   centreY_px = gy * stp + stp/2
//   x_norm     = centreX_px / w
//   y_norm     = centreY_px / h
//
// Then run simplifyRoute with a tolerance that scales slightly with gap:
//   - Higher gap means BFS is allowed to skip further, which typically
//     leads to noisier paths, so we allow a bit more smoothing.
// -----------------------------------------------------------------------
const out = path.map(([gx, gy]) => ({
  x: ((gx * stp) + (stp / 2)) / w,
  y: ((gy * stp) + (stp / 2)) / h,
}));

const simpTol = 0.003 + gapVal * 0.003; // higher gap -> allow more smoothing
const simplified = simplifyRoute(out, simpTol);
routePtsRef.current = simplified;

// -----------------------------------------------------------------------
// WAYPOINT BUILD + ORIENTATION CHECK
//
// We only rebuild the waypoint list and reset the index when we're at the
// start of a route (waypointIdxRef.current === 0). That way, if we’re
// mid-route and recompute for some reason, we don’t clobber the progress.
//
// Steps:
//   1) Build evenly spaced waypoints from the simplified path.
//   2) Decide whether we should walk the path forwards or reversed:
//        - Compare the user’s position to the first and last waypoint.
//        - If we’re closer to the end, reverse the waypoints so we walk
//          “from here to there” instead of “from there to here”.
//   3) Reset waypointIdxRef to 0 and store the list in both:
//        - waypointPtsRef.current (for sensor side)
//        - waypoints state (for UI / debug).
//   4) Update sensorMsg with a quick summary.
// -----------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// HIGH-LEVEL ROUTE STARTER + PREFETCH + START/CLEAR
//
// This whole chunk is the big-picture routing brain:
//
//   A) startRouteInternal(startPos, targetDest)
//      - Validates that:
//          * We know what floor we're on (selUrl).
//          * We have a starting position (userPos or lastUser.pos).
//          * We know which POI we're trying to get to.
//      - Finds the floor that actually owns the destination POI.
//      - Asks makePlan(selUrl, destFloor.url) for a cross-floor step list.
//      - Handles the "no shared warp keys" case when cross-floor routing
//        would be impossible with current manifests.
//      - Stores the plan into planRef + state and logs it for debugging.
//      - Prefetches the next floor's image (if the plan spans multiple
//        floors) into imageCacheRef so that when we warp, we don't have to
//        sit around waiting for naturalWidth/naturalHeight before we can
//        compute the next leg of the route.
//      - Immediately calls computeRouteForStep() for the first step so the
//        on-screen route is ready as soon as the plan is built.
//
//   B) startRoute()
//      - User-facing "go" button handler.
//      - Ensures we have:
//          * a destination (dest or destRef)
//          * a known starting position (userPos or lastUser.pos)
//      - If the user is *not* on the floor we’re currently viewing, it:
//          * stashes a pendingRoute { startPos, startUrl, destId }
//          * switches selUrl to that floor
//          * LETS THE FLOOR-CHANGE LOGIC resume the route later.
//      - If we’re already on the right floor, it just calls
//        startRouteInternal(startPos, targetDest).
//
//   C) clearRoute()
//      - Hard reset for navigation:
//          * wipes routePts and their refs
//          * wipes plan and planRef
//          * clears waypoints + waypoint indices
//          * nukes pendingRouteRef so nothing auto-resumes
// ---------------------------------------------------------------------------
const startRouteInternal = async (startPos, targetDest) => {
  const floor = floors.find((f) => f.url === selUrl);
  if (!floor || !startPos || !targetDest) return;

  // Figure out which floor actually owns the destination POI.
  const destFloor = floors.find((f) =>
    f.points?.some((p) => p.id === targetDest.id)
  );

  if (!destFloor) {
    setRouteMsg("Destination not found on any floor.");
    console.info("Route: destination not found", targetDest);
    return;
  }

  // Ask the high-level planner how to get from current floor to dest floor.
  const steps = makePlan(selUrl, destFloor.url);

  // If the plan is a single step but it's cross-floor, then there are no
  // shared warp keys between the two floors and we can't build a route.
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

  // Store the plan and reset its index to 0 (current leg).
  const planObj = { steps, index: 0 };
  planRef.current = planObj;
  setPlan(planObj);
  console.info("Route: plan built", planObj);

  // If there *is* a next step (i.e., multi-floor route), quietly preload
  // that floor's image into imageCacheRef so that after a warp, the system
  // can immediately compute the next route without waiting on image load.
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
      console.info("Route: preloaded next floor image", next.url);
    };
    img.src = next.url;
  }

  // Kick off the first leg’s actual geometry/graph route so the line shows up.
  if (planObj.steps[0]) {
    await computeRouteForStep(planObj.steps[0], startPos, planObj);
  }
};

const startRoute = async () => {
  const destId = dest?.id || destRef.current?.id;
  const targetDest = dest || destRef.current;

  if (!targetDest) {
    setRouteMsg("Select a destination room first.");
    return;
  }

  // Starting position comes from either:
  //   - userPos on the currently viewed floor, or
  //   - lastUser (the last known floor + pos for the user).
  const startPos = userPos || lastUser?.pos;
  const startUrl = userPos ? selUrl : lastUser?.url;

  if (!startPos || !startUrl) {
    setRouteMsg("Place yourself on the map first.");
    return;
  }

  // If we’re not currently *viewing* the user’s floor, switch there.
  // We stash a pendingRoute so that when the floor image actually loads,
  // some other effect can call startRouteInternal with the right values.
  if (startUrl !== selUrl) {
    pendingRouteRef.current = { startPos, startUrl, destId };
    setSensorMsg("Switching to your floor to build the route...");
    setSelUrl(startUrl);
    return;
  }

  // Already on the user’s floor: build the plan + route immediately.
  await startRouteInternal(startPos, targetDest);
};

const clearRoute = () => {
  // Clear drawn route line + internal refs tracking it.
  setRoutePts([]);
  routePtsRef.current = [];

  // Clear any existing plan object and its ref.
  setPlan(null);
  planRef.current = null;

  // Clear waypoints and their current index so step-through guidance resets.
  waypointPtsRef.current = [];
  setWaypoints([]);
  waypointIdxRef.current = 0;

  // Kill any queued auto-resume routing that might fire on next floor change.
  pendingRouteRef.current = null;

  console.info("Route: cleared");
};

// ---------------------------------------------------------------------------
// AUTO-WARP: STEP CLOSE → SWITCH FLOOR
//
// This effect is the “you’ve reached the stairs/elevator, let’s go up/down”
// logic. It only kicks in when:
//
//   - autoWarp is enabled
//   - there is an active plan with remaining steps
//   - the current step is a "warp" step and has a `target` (the warp POI)
//   - we have a userPos
//
// Flow when the user gets close enough (d <= warpProximity):
//
//   1) Grab the current plan (planRef or state) and the *next* plan step.
//   2) Find the matching warp POI on the next floor by:
//        - looking for a POI with:
//            kind: "poi"
//            poiType: "stairs" or "elevator"
//            warpKey: normalised match to step.key
//   3) If we find that match:
//        - Create `landing` at that POI's coordinates on the next floor.
//        - Persist that as the user position for the nextFloor.url.
//        - Figure out the destination POI for this entire route (destId).
//        - Set pendingRouteRef to resume routing once the new floor’s image
//          is ready, and set routeResumeRef to a callback that will:
//             * update destRef
//             * call startRouteInternal(landing, tgt)
//        - Switch selUrl to the next floor.
//        - Increment plan.index and reset routePts.
//        - Start a fallback timer (2.5s) that will call the resume callback
//          if onImgLoad never fires for some reason.
//
// This is what gives you the “walk into the stairwell, map flips to new
// floor and route continues” effect.
// ---------------------------------------------------------------------------
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

      // Schedule resume once next image loads; do not route immediately
      // because the image/position may not be ready yet.
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

// ---------------------------------------------------------------------------
// ROUTE RECOMPUTE ON FLOOR SWITCH
//
// This effect watches for changes to:
//   - selUrl (current floor image)
//   - plan (active cross-floor plan)
//   - gapCells (routing tolerance)
//
// It covers two scenarios:
//
//   1) We just switched floors *because* of a pendingRoute:
//        - If pendingRouteRef.current exists and its `startUrl` matches the
//          new selUrl, we:
//              * Look up the target destination POI (if any).
//              * Move pendingRouteRef → null.
//              * Store the target in destRef.
//              * Hook routeResumeRef to call startRouteInternal once the
//                image is ready.
//              * Set a 2.5s fallback timer that will call the resume
//                callback anyway if onImgLoad never fires.
//
//   2) We have an active plan and just changed floors manually to one of the
//      plan’s steps:
//        - If the current plan step’s URL matches selUrl, we call
//          computeRouteForStep(step, null, plan) to rebuild the route for
//          this floor with the current gap settings.
//
// The immediate IIFE is just a way to allow `await` inside the effect.
// ---------------------------------------------------------------------------
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
// Everything below is the “face” of the public map:
//   - Top controls (floor picker, manual location, search, route button)
//   - Scrollable map canvas with:
//       * Floor image
//       * User marker + heading arrow
//       * Room/POI markers
//       * Waypoints + animated route polyline
//   - Bottom toolbar for route and sensor behaviour toggles
//
// The stateful logic above is the brain; this is the dashboard.
// ---------------------------------------------------------------------------
return (
  <div className="card shadow-sm bg-card">
    <div className="card-body">
      {/* HEADER + TOP TOOLBAR
            - Page title for the public-facing map experience.
            - Floor selector: which image/floor we’re looking at.
            - “Manually set location” toggle:
                * Off  → normal pointer behaviour.
                * On   → clicking the map drops the user marker and snaps it
                         to the nearest walkable cell.
        */}
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
            className={`btn p-2 btn-sm rounded-pill ${placing ? "btn-dark" : "btn-outline-dark text-white"
              }`}
            onClick={() => setPlacing((p) => !p)}
          >
            {placing ? "Click map to set location" : "Manually set location"}
          </button>
        </div>

        {/* ROOM SEARCH BAR
              - Text box for room code (supports ranges/aliases via searchRoom()).
              - Press Enter or click the Search button to:
                  * walk all floors
                  * find the first matching point
                  * set that as destination + switch to that floor.
          */}
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

      {/* ROUTE BUTTON
            - Builds or rebuilds a route from the user’s current (or last
              known) position to the selected destination.
            - Disabled until both a userPos and dest are set.
        */}
      <div className="d-flex mb-2 w-100">
        <button
          className="btn btn-primary flex-grow-1 rounded-4"
          onClick={startRoute}
          disabled={!userPos || !dest}
        >
          Route
        </button>
      </div>

      {/* MAIN MAP CANVAS
            - Only rendered when a `floor` is selected.
            - Outer div: scrollable container with max height (so you don’t
              blow out the page on huge images).
            - `spacerRef` div:
                * Maintains the floor’s natural pixel dimensions.
                * Lets us overlay absolutely-positioned layers (contentRef)
                  on top of the image.
        */}
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
            {/* CONTENT LAYER
                  - This is the actual drawing surface where we:
                      * handle click-to-place (when `placing` is true)
                      * render the user marker
                      * render POI/room dots
                      * render waypoints and the route polyline
                  - cursor switches to crosshair in “placing” mode to give
                    visual feedback that clicks will move the user marker.
              */}
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
                // When in placing mode:
                //   1) Convert click from client pixels → normalised coords.
                //   2) Snap to nearest walkable cell (so user can’t
                //      accidentally land inside a wall).
                //   3) Save both in state and in localStorage.
                //   4) Turn off placing mode.
                if (!placing) return;
                const raw = toNorm(e.clientX, e.clientY);
                const p = snapToWalkable(raw.x, raw.y);
                setUserPos(p);
                saveUserPos(selUrl, p);
                setPlacing(false);
              }}
            >
              {/* Inline keyframes for the animated dashed route stroke. */}
              <style>{`@keyframes routeDash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }`}</style>

              {/* FLOOR IMAGE
                    - Backdrop for everything.
                    - `onLoad` wires into onImgLoad(), which:
                        * captures natural size
                        * builds the walkable grid
                        * resumes any pending route after warps.
                    - pointerEvents: "none" so clicks pass through to contentRef.
                */}
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

              {/* USER MARKER + HEADING ARROW
                    - Only shown if we have a userPos.
                    - The little IIFE pattern here is just to keep some
                      local variables (pos, size, angle) tidy:
                        {userPos && (() => { ...return <div>...</div> })()}
                    - Position is derived from normalised coords via toPx().
                    - The angle is the quantised displayHeading so the arrow
                      rotates to match either:
                        * sensor heading, or
                        * route direction while stepping.
                */}
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

              {/* ROOM / POI MARKERS
                    - One dot per point on the floor.
                    - `markerClass(p.kind)` chooses bootstrap colour by kind.
                    - Clicking a point sets it as the current destination.
                    - Tooltip shows room number + name/type for quick scanning.
                */}
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

              {/* WAYPOINT VISUALISATION
                    - Tiny translucent dots showing every “step” along the
                      prepared route. Helpful for debugging why the path goes
                      where it goes and for visualising route density.
                */}
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

              {/* ROUTE POLYLINE
                    - Foreground stroke: bright cyan, thinner, dashed.
                    - Background stroke: thicker, blurred, lower alpha to give
                      a subtle glow/halo effect under the main line.
                    - Both share the same points and dash animation for a
                      “moving dash” effect along the route.
                */}
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

      {/* EMPTY STATE: no manifest / no floors loaded yet. */}
      {!floor && (
        <div className="text-muted">No published floors available yet.</div>
      )}

      {/* BOTTOM TOOLBAR
            - Clear: wipes current route/plan/waypoints.
            - Auto warp toggle: enable/disable automatic floor switching when
              you walk into a warp POI.
            - Accessibility mode: bias towards elevators when choosing warps.
              (Button continues below this snippet.)
        */}
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
          className={`btn btn-${accessibleMode ? "secondary" : "outline-secondary"
            } btn-sm`}
          onClick={() => {
            setAccessibleMode((v) => !v);

            {/* ACCESSIBILITY + SENSOR CONTROLS + STEP TUNING
              - Accessibility button:
                  * Toggles between “Any” warp (stairs or elevator) and
                    “Elevator-only” routing hints.
                  * When toggled, we clear the current plan/route/waypoints so
                    the *next* route rebuild re-evaluates warp choices under
                    the new mode.
              - Sensor tracking button:
                  * Start tracking:
                      - Requests motion/orientation permissions.
                      - Hooks up devicemotion listeners and step detection.
                  * Stop tracking:
                      - Tears down watchers and resets calibration so the next
                        session starts clean.
                  * Disabled if we don’t have a userPos yet (no point in
                    sensor movement with no starting marker).
              - Step slider:
                  * Adjusts `moveStep` = how far the marker jumps per Arrow
                    key press in desktop testing.
                  * This only affects keyboard movement, not sensor-based
                    stepping.
              - searchMsg / routeMsg:
                  * Quick text feedback for search and routing.
            */}
            <><button
              className={`btn btn-${accessibleMode ? "secondary" : "outline-secondary"} btn-sm`}
              onClick={() => {
                // Clear current plan so the next route rebuild honors the mode
                setAccessibleMode((v) => !v);
                setPlan(null);
                setRoutePts([]);
                waypointPtsRef.current = [];
                waypointIdxRef.current = 0;
              }}
            >
              Accessibility: {accessibleMode ? "Elevator" : "Any"}
            </button><button
              className={`btn btn-${sensorTracking ? "danger" : "success"} btn-sm`}
              onClick={sensorTracking ? stopSensorTracking : startSensorTracking}
              disabled={!sensorTracking && !userPos}
            >
                {sensorTracking ? "Stop tracking" : "Start tracking"}
              </button><div
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
                  style={{ width: 120 }} />
                <span>{moveStep.toFixed(3)}</span>
              </div></>

            { searchMsg && <span className="small text-muted">{searchMsg}</span> }
            { routeMsg && <span className="small text-muted">{routeMsg}</span> }
        </div>

      {/* SENSOR STATUS + DEBUG PANEL
            - sensorMsg:
                * High-level human-readable status string about what the
                  sensor pipeline is doing right now:
                    - “Calibrating sensors…”
                    - “Tracking paused.”
                    - Error messages when permissions fail, etc.
            - DebuggerPanel:
                * Developer-only dashboard with raw heading/gyro/accel data.
                * Uses the `debugVisible` flag (toggled elsewhere) to show/hide.
                * Shows:
                    - raw heading vs displayHeading
                    - compassHeading and yaw
                    - accelMagnitude + baseline sample count
                    - whether baseline calibration is ready
                    - the current sensorMsg
                    - current headingOffset
                    - whether we’re recording sensor samples to JSON and the
                      last recordMsg.
              This makes it much easier to sanity-check sensor behaviour on
              real hardware without drowning the UI in raw numbers.
        */}
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

