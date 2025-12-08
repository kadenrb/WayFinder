/* 
  App Shell – what this file is actually doing:
  - This is the public-facing WayFinder landing shell.
  - It shows:
      - The header with logo + "Own a business?" admin link.
      - A "Get notified" flow so users can register interest by email + location.
      - An "Unsubscribe" flow to remove themselves from notifications.
      - A live UserMap view (the interactive bit).
      - A published-floor preview pulled from an S3 manifest (MapPreview + floor selector).
  - It also owns the global toast system for quick success/error messages.

  Mental model:
  - Think of this as the front door for normal users:
      - "I want to use WayFinder" → see map + preview.
      - "I want to know when *my* place is added" → email + location modal.
      - "I own a business" → admin sign-in.
*/

import React, { useState, useEffect, useMemo } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import logo from "./images/logo.png";
import UserMap from "./UserMap";
import { Link } from "react-router-dom";
import Select from "react-select";

/*
  Manifest configuration:
  - MANIFEST_URL points at the public S3 JSON that lists all published floors.
  - In dev, you can override this with REACT_APP_MANIFEST_URL.
  - In prod, it’ll typically use the S3 URL defined here or injected via env.
  - The manifest is expected to look like:
      { floors: [{ id, name, url }, ...] }
*/
const MANIFEST_URL =
  process.env.REACT_APP_MANIFEST_URL ||
  "https://wayfinder-floors.s3.us-east-2.amazonaws.com/floors/manifest.json";

/*
  API configuration:
  - All auth-ish operations (signup / delete) talk to this API_URL.
  - Same pattern as elsewhere:
      - Use REACT_APP_API_URL in real deployments,
      - Fall back to http://localhost:5000 for local dev.
*/
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

/*
  Quick utility: email format validator
  - Not bulletproof, but good enough for "did you type something vaguely email-shaped".
  - Real validation still happens on the backend.
*/
const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function App() {
  /*
    Top-level UI state for this shell:
    - promptEmail: controls whether the "Get notified" modal is open.
    - deleteEmail: controls whether the "Unsubscribe" modal is open.
    - userEmail: the email the user is typing (shared by both modals).
    - location: an array of location tags from the multi-select (e.g., ["RDP", "CollicuttCentre"]).
    - showToast / toastMessage: handle the little notification popup in the corner.
    - floors: list of published floors pulled from the S3 manifest.
    - selectedFloorId: which floor is currently selected in the dropdown (id or name).
    - manifestStatus / manifestError: basic loading/error state for the manifest fetch.
    - showHelp: controls whether the "Help" modal is open.
    - showKiosk: controls whether the "Kiosk" modal is open.
    - showPhone: controls whether the "Phone" modal is open.
  */
  const [promptEmail, setPromptEmail] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [location, setLocation] = useState([]);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [floors, setFloors] = useState([]);
  const [selectedFloorId, setSelectedFloorId] = useState(null);
  const [manifestStatus, setManifestStatus] = useState("idle");
  const [manifestError, setManifestError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [showKiosk, setShowKiosk] = useState(false);
  const [showPhone, setShowPhone] = useState(false);

  /*
    Static list of locations for the notification system:
    - These map to "tags" on the backend.
    - User picks one or more of these when they request notifications.
    - The values are what get sent to the API; the labels are for humans.
  */
  const options = [
    { value: "RDP", label: "Red Deer Polytechnic" },
    { value: "GaryWHarris", label: "Gary W. Harris Canada Games Centre" },
    { value: "CollicuttCentre", label: "Collicutt Centre" },
    { value: "MichenerAquatic", label: "Michener Aquatic Centre" },
    { value: "ServusArena", label: "Servus Arena" },
    { value: "Centrium", label: "Marchant Crane Centrium" },
    { value: "RedDeerMAG", label: "Red Deer Museum & Art Gallery" },
    { value: "KerryWood", label: "Kerry Wood Nature Centre" },
    { value: "FortNormandeau", label: "Fort Normandeau Interpretation Site" },
    { value: "ÉcoleNotreDame", label: "École Notre Dame High School" },
    { value: "RossBusinessPark", label: "Ross Business Park" },
  ];

  /*
    handleSubmit – "Get notified" flow:
    - Validates:
        - Email looks valid.
        - At least one location is selected.
    - Sends POST /auth/signup with:
        { email: userEmail, tags: locationArray }
    - On success:
        - Shows a toast saying the signup worked.
        - Closes the modal and clears local inputs.
    - On failure:
        - Logs the error to console for devs.
        - Shows a toast with the error message so the user isn’t left guessing.

    Notes:
    - We use the same toast system for both success and errors — simple & consistent.
    - `location` is an array, so we clear it back to [] after a successful submit.
  */
  const handleSubmit = async () => {
    if (!validateEmail(userEmail) || !location.length) return;

    try {
      const response = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, tags: location }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save user to db");
      }

      setToastMessage(
        `${userEmail} successfully signed up for notifications at ${location.join(
          ", "
        )}`
      );
      setShowToast(true);

      setPromptEmail(false);
      setUserEmail("");
      setLocation([]);
    } catch (err) {
      console.error(err);
      setToastMessage(`Error: ${err.message}`);
      setShowToast(true);
    }
  };

  /*
    deleteUser – "Unsubscribe" flow:
    - Only cares about a valid email.
    - Sends POST /auth/delete-user with:
        { email: userEmail }
    - On success:
        - Shows a toast confirming unsubscribe.
        - Closes the modal and clears local inputs.
    - On failure:
        - Logs the error.
        - Shows a toast with the error message.

    This is intentionally simple:
    - No locations, no tags, just "this email is out".
  */
  const deleteUser = async () => {
    if (!validateEmail(userEmail)) return;

    try {
      const response = await fetch(`${API_URL}/auth/delete-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete user from db");
      }

      setToastMessage(
        `${userEmail} successfully unsubscribed from notifications`
      );
      setShowToast(true);

      setDeleteEmail(false);
      setUserEmail("");
      setLocation([]);
    } catch (err) {
      console.error(err);
      if (err.message === "User not found") {
        setToastMessage(`Sorry, email ${userEmail} not found in our records.`);
      } else {
        setToastMessage(`Error: ${err.message}`);
      }
      setShowToast(true);
    }
  };

  /*
    Toast auto-hide:
    - Any time showToast flips to true, this effect sets a 3-second timer.
    - After 3 seconds, it hides the toast again.
    - If the toast is re-triggered before the timer finishes, the effect reruns
      and we get a fresh 3-second countdown.
  */
  useEffect(() => {
    if (!showToast) return;
    const timer = setTimeout(() => setShowToast(false), 3000);
    return () => clearTimeout(timer);
  }, [showToast]);

  /*
    Manifest loader – fetches published floors from S3:
    - Runs once on mount.
    - Uses MANIFEST_URL to fetch the JSON manifest (no-store to avoid stale caching).
    - Expects a "floors" array; if missing or malformed, falls back to [].
    - Picks a default floor:
        - Prefer manifestFloors[0].id if present, otherwise .name.
    - Sets:
        - floors
        - selectedFloorId
        - manifestStatus ("ready" / "error")
        - manifestError on failure

    The `active` flag is a little safety net:
    - If the component unmounts before the fetch resolves,
      we bail out and avoid setting state on an unmounted component.
  */
  useEffect(() => {
    if (!MANIFEST_URL) return;

    let active = true;

    const loadManifest = async () => {
      setManifestStatus("loading");
      try {
        const res = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!active) return;

        const manifestFloors = Array.isArray(data?.floors) ? data.floors : [];
        setFloors(manifestFloors);

        const defaultId =
          manifestFloors[0]?.id || manifestFloors[0]?.name || null;
        setSelectedFloorId(defaultId);

        setManifestStatus("ready");
        setManifestError("");
      } catch (err) {
        if (!active) return;
        console.error("Failed to load manifest", err);
        setFloors([]);
        setSelectedFloorId(null);
        setManifestStatus("error");
        setManifestError("Unable to load published floors.");
      }
    };

    loadManifest();

    return () => {
      active = false;
    };
  }, []);

  /*
    selectedFloor – derived view of "what floor are we actually using":
    - If no floors exist, returns null.
    - Otherwise, tries to find a floor whose id *or* name matches selectedFloorId.
    - If it can’t find a match (e.g., weird data), it falls back to floors[0].
    - This memo is purely for convenience so MapPreview can just get:
        imageUrl={selectedFloor?.url}
  */
  const selectedFloor = useMemo(() => {
    if (!floors.length) return null;
    return (
      floors.find(
        (f) => f.id === selectedFloorId || f.name === selectedFloorId
      ) || floors[0]
    );
  }, [floors, selectedFloorId]);

  return (
    <>
      {/*
        TOAST CONTAINER:
        - Fixed in the top-right corner.
        - Shows only when showToast is true.
        - Uses Bootstrap's "toast" styling but is manually controlled via React state.
      */}
      <div className="toast-container position-fixed top-0 end-0 p-3">
        {showToast && (
          <div
            className="toast show align-items-center text-bg-primary border-0"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <div className="d-flex">
              <div className="toast-body">{toastMessage}</div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                onClick={() => setShowToast(false)}
              ></button>
            </div>
          </div>
        )}
      </div>
      {/*
        HEADER:
        - Big WayFinder brand with logo.
        - "Own a business?" button that routes to /admin/sign-in.
        - "Get notified" button that flips on the email/location modal.
      */}
      <div className="bg-head rounded">
        <header>
          <div className="fw-bold d-flex align-items-center justify-content-center">
            <img src={logo} alt="WayFinder Logo" className="logo-img" />
            <div>
              <div className="text-shadow size-title">
                <span className="text-blue fancy-font way-shift">Way</span>
                <span className="text-orange fancy-font">Finder</span>
              </div>
              <div className="text-light slogan fancy-font text-end">
                Find your way, your way
              </div>
            </div>
          </div>
        </header>
      </div>

      <div class="bg-card py-3 border-bottom-blue border-top-orange rounded">
        <nav className="d-flex justify-content-between align-items-center mx-2 gap-1">
          <Link
            className="btn btn-outline-primary btn-sm fw-bold py-2"
            to="/admin/sign-in"
          >
            Own a business?
          </Link>
          <button
            className="btn btn-outline-info text-info btn-sm text-shadow-sm px-1 py-2 fw-bold"
            onClick={() => setShowHelp(true)}
          >
            How to use
            <i className="bi bi-info-circle-fill ms-2"></i>
          </button>
          <button
            className="btn btn-outline-primary btn-sm fw-bold py-2"
            onClick={() => setPromptEmail(true)}
          >
            Get notified
          </button>
        </nav>
      </div>

      {/*
        HELP MODAL:
        - Shows a modal with instructions for using WayFinder.
        - Uses Bootstrap's "modal" styling but is manually controlled via React state.
      */}
      {showHelp && (
        <div className="modal fade show d-block" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content bg-card-dark text-white shadow">
              <div className="modal-header justify-content-center align-items-center">
                <h5 className="modal-title">
                  <span className="ms-2 text-blue fancy-font display-3 text-shadow-sm">
                    Way
                  </span>
                </h5>
                <span className="text-orange fancy-font display-3 text-shadow-sm">
                  Finder
                </span>
                <button
                  className="btn btn-outline-danger btn-sm position-absolute top-0 end-0 m-2"
                  onClick={() => setShowHelp(false)}
                >
                  X
                </button>
              </div>

              <div className="modal-body text-center">
                <p>What do you need help with?</p>

                <button
                  className="btn btn-primary w-100 mb-2 fw-bold"
                  onClick={() => {
                    setShowHelp(false);
                    setShowKiosk(true);
                  }}
                >
                  <i className="bi bi-display me-2"></i>
                  Kiosk
                </button>
                <button
                  className="btn btn-info w-100 fw-bold text-white"
                  onClick={() => {
                    setShowHelp(false);
                    setShowPhone(true);
                  }}
                >
                  <i className="bi bi-phone me-2 text-white"></i>
                  Phone
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        KIOSK HELP MODAL:
        - Shows a modal with instructions for using the kiosk.
        - Uses Bootstrap's "modal" styling but is manually controlled via React state.
      */}

      {showKiosk && (
        <div className="modal fade show d-block" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content text-card bg-card-dark">
              <div className="modal-header justify-content-center display-3 position-relative">
                <h5 className="modal-title fancy-font display-4 text-shadow-sm text-center">
                  <span className="text-orange">Kiosk</span>{" "}
                  <span className="text-blue">Help</span>
                </h5>
                <button
                  className="btn btn-outline-danger btn-sm position-absolute top-0 end-0 m-2"
                  onClick={() => setShowKiosk(false)}
                >
                  X
                </button>
              </div>

              <div className="modal-body">
                <ol className="ps-3">
                  <li>
                    Sign up for notifications or access different maps
                    (optional).
                  </li>
                  <li>
                    Turn on Accessibility{" "}
                    <i className="bi bi-person-wheelchair text-primary"></i> if
                    you have trouble going up or down stairs.
                  </li>
                  <li>
                    Search for a destination by typing the room number (ex:
                    B501) <strong>OR</strong>
                  </li>
                  <li>
                    Click your destination directly on the map (make sure to
                    choose the correct floor).
                  </li>
                  <li>
                    Navigate back to the starting floor (if you changed it) and
                    click the <strong>Route</strong> button to generate your
                    path.
                  </li>

                  <li>
                    Send the route to your phone by clicking the{" "}
                    <i className="bi bi-qr-code-scan"></i> QR code icon and scan
                    it.
                  </li>
                  <li>Follow the route to your destination from your phone.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        PHONE HELP MODAL:
        - Shows a modal with instructions for using the phone app.
        - Uses Bootstrap's "modal" styling but is manually controlled via React state.
      */}

      {showPhone && (
        <div className="modal fade show d-block" tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content text-card bg-card-dark">
              <div className="modal-header justify-content-center w-100 position-relative">
                <h5 className="modal-title fancy-font display-4 text-shadow-sm text-center">
                  <span className="text-orange">Phone</span>{" "}
                  <span className="text-blue">Help</span>
                </h5>
                <button
                  className="btn btn-outline-danger btn-sm position-absolute top-0 end-0 m-2"
                  onClick={() => setShowPhone(false)}
                >
                  X
                </button>
              </div>

              <div className="modal-body">
                <ol className="ps-3">
                  <li>Load WayFinder / scan QR code.</li>
                  <li>
                    If your browser is compatible, click{" "}
                    <strong>Start Tracking</strong> on the popup menu.
                  </li>
                  <li>
                    If you scanned the QR code from a kiosk, simply hit route!
                  </li>
                  <li>
                    Sign up for notifications or access different maps
                    (optional).
                  </li>
                  <li>
                    Turn on Accessibility{" "}
                    <i className="bi bi-person-wheelchair text-primary"></i> if
                    you have trouble going up or down stairs.
                  </li>
                  <li>
                    Click on the “You Are Here” button and select your general
                    area. (If needed, change the floor you are on.)
                  </li>
                  <li>
                    Search a destination by typing in the room number you need
                    (ex: B501). <strong>OR</strong>
                  </li>
                  <li>
                    Click your destination directly on the map (make sure to
                    choose the correct floor).
                  </li>
                  <li>
                    Navigate back to the starting floor (if you changed it) and
                    click the <strong>Route</strong> button to generate your
                    path.
                  </li>
                  <li>
                    Follow the route to the destination! Be sure to clear your
                    route once you arrive.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        "GET NOTIFIED" MODAL:
        - Shows when promptEmail is true.
        - Custom-styled overlay + dialog instead of relying on Bootstrap's JS.
        - Fields:
            - Email input
            - Multi-select location picker (react-select)
        - Actions:
            - Submit (calls handleSubmit; disabled until email + at least one location).
            - Cancel (simply closes the modal).
            - Unsubscribe (closes this modal and opens the unsubscribe modal).
      */}
      {promptEmail && (
        <div
          aria-modal="true"
          role="dialog"
          style={{
            // default settings for a popup modal
            position: "fixed",
            inset: 0,
            zIndex: 1050,
            backgroundColor: "rgba(0,0,0,0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "1rem",
            overflowY: "auto",
          }}
        >
          <div className="bg-card-dark rounded-5 p-3 shadow">
            {/* Modal header */}
            <div className="modal-header text-center mb-2 justify-content-between">
              <h5 className="modal-title text-card" style={{ margin: 0 }}>
                Enter Your Email & Location to Get Notified
              </h5>
            </div>

            {/* Modal body */}
            <div className="border-top border-bottom">
              <div className="modal-body py-4">
                <input
                  type="text"
                  className="form-control mb-2 bg-card-inner"
                  placeholder="Enter a valid email..."
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                />

                <Select
                  options={options}
                  value={options.filter((o) => location.includes(o.value))}
                  onChange={(vals) => setLocation(vals.map((v) => v.value))}
                  isMulti
                  placeholder="Select location(s)..."
                  styles={{
                    menuList: (base) => ({
                      ...base,
                      maxHeight: "200px",
                      overflowY: "auto",
                      paddingBottom: "0.75rem",
                    }),
                  }}
                />
              </div>
            </div>
            {/* Modal footer */}
            <div className="modal-footer d-flex flex-column gap-3">
              {/* Primary actions */}
              <div className="d-flex flex-column gap-2 w-75 mt-3 mx-3">
                <button
                  className="btn btn-primary btn-lg w-100"
                  disabled={!validateEmail(userEmail) || !location.length}
                  onClick={handleSubmit}
                >
                  Submit
                </button>

                <button
                  className="btn btn-outline-primary w-100"
                  onClick={() => setPromptEmail(false)}
                >
                  Cancel
                </button>
              </div>
              <div className="d-flex justify-content-center w-100 mb-2">
                <button
                  className="btn btn-sm btn-outline-danger w-50"
                  onClick={() => {
                    setPromptEmail(false);
                    setDeleteEmail(true);
                  }}
                >
                  Unsubscribe
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        MAIN USER MAP:
        - The interactive piece that shows the actual building map/routing.
        - All the heavy lifting is inside <UserMap />; we just drop it in here.
      */}
      <div>
        <UserMap />
      </div>

      {/*
        "UNSUBSCRIBE" MODAL:
        - Shows when deleteEmail is true.
        - Only asks for an email.
        - Unsubscribe button is disabled until the email looks valid.
      */}
      {deleteEmail && (
        <div
          aria-modal="true"
          role="dialog"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1050,
            backgroundColor: "rgba(0,0,0,0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "1rem",
            overflowY: "auto",
          }}
        >
          <div className="bg-card-dark rounded-5 p-3 shadow">
            {/* Modal header */}
            <div className="modal-header text-center mb-2 justify-content-between">
              <h5 className="modal-title text-card m-0">
                Enter Your Email to Unsubscribe
              </h5>
            </div>

            {/* Modal body */}
            <div className="border-top border-bottom">
              <div className="modal-body py-4">
                <input
                  type="text"
                  className="form-control mb-2 bg-card-inner"
                  placeholder="Enter your email..."
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="modal-footer d-flex flex-column gap-3">
              <div className="d-flex flex-column gap-2 w-75 mt-3 mx-3">
                <button
                  className="btn btn-danger btn-lg w-100"
                  onClick={validateEmail(userEmail) ? deleteUser : undefined}
                  disabled={!validateEmail(userEmail)}
                >
                  Unsubscribe
                </button>
                <button
                  className="btn btn-outline-primary w-100"
                  onClick={() => setDeleteEmail(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        MAP PREVIEW + FLOOR SELECTOR used for dev testing:
        - MapPreview gets the URL for the currently selected floor’s image.
        - Below that:
            - "loading" message while the manifest is being fetched.
            - Error message if the manifest fetch failed.
            - A floor selector dropdown if there’s more than one floor.
      */}
      {/* <div className="mt-4">
        <MapPreview imageUrl={selectedFloor?.url} />

        <div className="mt-2">
          {manifestStatus === "loading" && (
            <span className="text-muted small">Loading published floors…</span>
          )}

          {manifestStatus === "error" && (
            <span className="text-danger small">{manifestError}</span>
          )}

          {floors.length > 1 && (
            <div className="d-flex align-items-center gap-2 mt-2">
              <label className="form-label small m-0" htmlFor="floorSelect">
                Floor:
              </label>
              <select
                id="floorSelect"
                className="form-select form-select-sm"
                value={selectedFloorId ?? ""}
                onChange={(e) => setSelectedFloorId(e.target.value)}
              >
                {floors.map((floor) => (
                  <option
                    key={floor.id || floor.name}
                    value={floor.id || floor.name}
                  >
                    {floor.name || "Unnamed floor"}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div> */}
    </>
  );
}

export default App;
