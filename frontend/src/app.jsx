import React, { useState, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import logo from "./images/logo.png";
import MapPreview from "./MapPreview";
import { Link, useNavigate } from "react-router-dom";
function App() {
  const [promptEmail, setPromptEmail] = useState(false); // Controls display of email signup modal
  const [userEmail, setUserEmail] = useState(""); // Stores user email input
  const [location, setLocation] = useState(""); // Stores user location selection
  const [showToast, setShowToast] = useState(false); // Controls display of notification toast
  const [toastMessage, setToastMessage] = useState(""); // Stores notification message

  const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async () => {
    if (!validateEmail(userEmail) || !location) return;

    try {
      const response = await fetch("http://localhost:5000/auth/signup", {
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
      <MapPreview /> {/* Have to pass the correct map eventually */}
    </>
  );
}

export default App;
