// APP SHELL — concise overview
// Top-level app wrapper. Wires routes to SignIn/Register/LandingPage.
import React, { useState, useEffect, useMemo } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import logo from "./images/logo.png";
import MapPreview from "./MapPreview";
import UserMap from "./UserMap";
import { Link, useNavigate } from "react-router-dom";

const MANIFEST_URL =
  process.env.REACT_APP_MANIFEST_URL ||
  "https://wayfinder-floors.s3.us-east-2.amazonaws.com/floors/manifest.json";

function App() {
  const [promptEmail, setPromptEmail] = useState(false); // Controls display of email signup modal
  const [deleteEmail, setDeleteEmail] = useState(false); // Controls display of email delete modal
  const [userEmail, setUserEmail] = useState(""); // Stores user email input
  const [location, setLocation] = useState(""); // Stores user location selection
  const [showToast, setShowToast] = useState(false); // Controls display of notification toast
  const [toastMessage, setToastMessage] = useState(""); // Stores notification message
  const [floors, setFloors] = useState([]);
  const [selectedFloorId, setSelectedFloorId] = useState(null);
  const [manifestStatus, setManifestStatus] = useState("idle");
  const [manifestError, setManifestError] = useState("");

  const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
  const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async () => {
    if (!validateEmail(userEmail) || !location) return;

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

      // Show success notification
      setToastMessage(
        `${userEmail} successfully signed up for notifications at ${location}`
      );
      setShowToast(true);

      setPromptEmail(false);
      setUserEmail("");
      setLocation("");
    } catch (err) {
      console.error(err);
      setToastMessage(`Error: ${err.message}`);
      setShowToast(true);
    }
  };

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

      // Show success notification
      setToastMessage(
        `${userEmail} successfully unsubscribed from notifications`
      );
      setShowToast(true);

      setDeleteEmail(false);
      setUserEmail("");
      setLocation("");
    } catch (err) {
      console.error(err);
      setToastMessage(`Error: ${err.message}`);
      setShowToast(true);
    }
  };

  // Auto-hide notification after 3 seconds
  useEffect(() => {
    if (!showToast) return;
    const timer = setTimeout(() => setShowToast(false), 3000);
    return () => clearTimeout(timer);
  }, [showToast]);

  // Load published floors from S3 manifest
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

  const selectedFloor = useMemo(() => {
    if (!floors.length) return null;
    return (
      floors.find(
        (f) =>
          f.id === selectedFloorId ||
          f.name === selectedFloorId
      ) || floors[0]
    );
  }, [floors, selectedFloorId]);

  return (
    <>
      {/* Notification bootstrap toast */}
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
      <div className="bg-head p-3 rounded border-bottom">
        <header
          className="d-flex flex-column flex-md-row justify-content-between 
              align-items-center mb-3 text-center"
        >
          <div
            className="display-3 fw-bold text-shadow mb-3 d-flex align-items-center 
                justify-content-center justify-content-start"
          >
            <img src={logo} alt="WayFinder Logo" className="me-2" />
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
      {/* Signup bootstrap modal */}
      {promptEmail && (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-head">
                <h5 className="modal-title text-white">
                  Enter Your Email & Location to Get Notified
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setPromptEmail(false)}
                ></button>
              </div>
              <div className="modal-body d-flex gap-2">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Enter a valid email..."
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  style={{ flex: 3 }}
                />
                <select
                  className="form-select"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">
                    Location - Chose where you want updates
                  </option>
                  <option value="RDP">RDP - Red Deer Polytechnic</option>
                  <option value="Grand Canyon">Grand Canyon</option>
                  <option value="Rocky Mountains">Rocky Mountains</option>
                </select>
              </div>
              <div className="modal-footer bg-content">
                <button
                  className="btn btn-outline-danger me-auto"
                  onClick={() => {
                    setPromptEmail(false);
                    setDeleteEmail(true);
                  }}
                >
                  Unsubscribe
                </button>
                <button
                  className="btn btn-outline-primary"
                  onClick={() => setPromptEmail(false)}
                >
                  Cancel
                </button>
                {validateEmail(userEmail) && location ? (
                  <button className="btn btn-primary" onClick={handleSubmit}>
                    Submit
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled>
                    Submit
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Public multi-floor viewer (uses published floors). */}
      <div className="mt-4">
        <UserMap />
      </div>
      {deleteEmail && (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-head">
                <h5 className="modal-title text-white">
                  Enter Your Email to Unsubscribe
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setDeleteEmail(false)}
                ></button>
              </div>
              <div className="modal-body d-flex gap-2">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Enter your email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  style={{ flex: 3 }}
                />
              </div>
              <div className="modal-footer bg-content">
                <button
                  className="btn btn-outline-primary"
                  onClick={() => setDeleteEmail(false)}
                >
                  Cancel
                </button>
                {validateEmail(userEmail) ? (
                  <button className="btn btn-danger" onClick={deleteUser}>
                    Unsubscribe
                  </button>
                ) : (
                  <button className="btn btn-danger" disabled>
                    Unsubscribe
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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
