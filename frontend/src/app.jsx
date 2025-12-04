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
import MapPreview from "./MapPreview";
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
      setToastMessage(`Error: ${err.message}`);
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
      <div className="bg-head p-3 rounded border-bottom">
        <header
          className="d-flex flex-column flex-md-row justify-content-between 
              align-items-center mb-3 text-center"
        >
          <div
            className="display-3 fw-bold text-shadow mb-3 d-flex align-items-center 
                justify-content-center justify-content-start"
          >
            <img src={logo} alt="WayFinder Logo" className="me-2 logo-img" />
            <span className="text-blue">Way</span>
            <span className="text-orange">Finder</span>
          </div>

          <nav className="d-flex flex-column flex-sm-row gap-2">
            <Link
              className="btn btn-outline-primary fw-bold"
              to="/admin/sign-in"
            >
              Own a business?
            </Link>
            <button
              className="btn btn-primary fw-bold"
              onClick={() => setPromptEmail(true)}
            >
              Get notified
            </button>
          </nav>
        </header>
      </div>

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
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--bs-body-bg, #fff)",
              borderRadius: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Modal header */}
            <div
              className="modal-header bg-head"
              style={{ padding: "0.75rem 1rem" }}
            >
              <h5 className="modal-title text-white" style={{ margin: 0 }}>
                Enter Your Email & Location to Get Notified
              </h5>
              <button
                type="button"
                className="btn-close"
                onClick={() => setPromptEmail(false)}
              />
            </div>

            {/* Modal body */}
            <div className="modal-body py-4 bg-head">
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

            {/* Modal footer */}
            <div className="modal-footer bg-content d-flex flex-column gap-3">
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

              {/* Danger action, visually separated */}
              <div className="d-flex justify-content-center w-100 mb-2">
                <button
                  className="btn btn-sm btn-outline-danger w-25"
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
      <div className="mt-4">
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
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--bs-body-bg, #fff)",
              borderRadius: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Modal header */}
            <div
              className="modal-header bg-head"
              style={{ padding: "0.75rem 1rem" }}
            >
              <h5 className="modal-title text-white" style={{ margin: 0 }}>
                Enter Your Email to Unsubscribe
              </h5>
              <button
                type="button"
                className="btn-close-white ms-4 px-2"
                onClick={() => setDeleteEmail(false)}
              />
            </div>

            {/* Modal body */}
            <div className="modal-body bg-head">
              <input
                type="text"
                className="form-control bg-card-inner"
                placeholder="Enter your email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
              />
            </div>

            {/* Modal footer */}
            <div
              className="modal-footer bg-content"
              style={{ padding: "0.75rem", display: "flex", gap: 8 }}
            >
              <button
                className="btn btn-outline-primary"
                onClick={() => setDeleteEmail(false)}
                style={{ flex: 1 }}
              >
                Cancel
              </button>

              <button
                className="btn btn-danger"
                onClick={validateEmail(userEmail) ? deleteUser : undefined}
                disabled={!validateEmail(userEmail)}
                style={{ flex: 1 }}
              >
                Unsubscribe
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        MAP PREVIEW + FLOOR SELECTOR:
        - MapPreview gets the URL for the currently selected floor’s image.
        - Below that:
            - "loading" message while the manifest is being fetched.
            - Error message if the manifest fetch failed.
            - A floor selector dropdown if there’s more than one floor.
      */}
      <div className="mt-4">
        <MapPreview imageUrl={selectedFloor?.url} />

        <div className="mt-2">
          {manifestStatus === "loading" && (
            <span className="text-muted small">
              Loading published floors…
            </span>
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
      </div>
    </>
  );
}

export default App;
