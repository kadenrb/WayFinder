import React, { useState } from "react";
import SendEmailBtn from "./sendEmailBtn";
import DragMapArea from "./DragMapArea";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import logo from "./images/logo.png";

function App() {
  const [promptEmail, setPromptEmail] = React.useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [location, setLocation] = useState("");
  const validateEmail = (email) => {
    // Basic email regex
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center p-4 bg-head border-bottom">
        <h1 className="text-2xl fw-bold text-center flex-grow-1">
          Welcome to WayFinder
          <img src={logo} alt="WayFinder Logo" className="img" />
        </h1>
        <button
          className="btn btn-primary"
          onClick={() => setPromptEmail(true)}
        >
          Want to get notified?
        </button>
      </div>

      {promptEmail && (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-head">
                <h5 className="modal-title">
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
                  placeholder="Enter your email..."
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  required
                  style={{ flex: 3 }}
                />

                <select
                  className="form-select"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  required
                  style={{ flex: 1 }}
                >
                  <option value="">Location</option>
                  <option value="RDP">RDP - Red Deer Polytechnic</option>
                  <option value="Grand Canyon">Grand Canyon</option>
                  <option value="Rocky Mountains">Rocky Mountains</option>
                </select>
              </div>

              <div className="modal-footer bg-content">
                <button
                  className="btn btn-secondary"
                  onClick={() => setPromptEmail(false)}
                >
                  Cancel
                </button>

                {/* This is an if else to check if the user has entered a valid email address & location for the button to submit to appear */}

                {validateEmail(userEmail) && location ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => alert(userEmail)}
                  >
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
    </>
  );
}

export default App;
