// APP SHELL — concise overview
// Top-level app wrapper. Wires routes to SignIn/Register/LandingPage.
import React, { useState, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import logo from "./images/logo.png";
import MapPreview from "./MapPreview";
import UserMap from "./UserMap";
import { Link, useNavigate } from "react-router-dom";
import Select from "react-select";

function App() {
  const [promptEmail, setPromptEmail] = useState(false); // Controls display of email signup modal
  const [deleteEmail, setDeleteEmail] = useState(false); // Controls display of email delete modal
  const [userEmail, setUserEmail] = useState(""); // Stores user email input
  const [location, setLocation] = useState([]); // Stores user location selection
  const [showToast, setShowToast] = useState(false); // Controls display of notification toast
  const [toastMessage, setToastMessage] = useState(""); // Stores notification message
  const options = [
    // Location options for multi-select
    { value: "RDP", label: "Red Deer Polytechnic" },
    { value: "GaryWHarris", label: "Gary W. Harris Canada Games Centre" },
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
      {/* Signup bootstrap modal */}
      {/* NOTIFY MODAL */}
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
            {/* Header */}
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

            {/* Body */}
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

            {/* Footer */}
            <div className="modal-footer bg-content d-flex flex-column gap-3">
              {/* Primary column */}
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

              {/* Isolated danger action */}
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

      {/* MAP VIEW */}
      <div className="mt-4">
        <UserMap />
      </div>

      {/* DELETE / UNSUBSCRIBE MODAL */}
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
            {/* Header */}
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

            {/* Body */}
            <div className="modal-body bg-head">
              <input
                type="text"
                className="form-control bg-card-inner"
                placeholder="Enter your email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
              />
            </div>

            {/* Footer */}
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

      <MapPreview />
    </>
  );
}

export default App;
