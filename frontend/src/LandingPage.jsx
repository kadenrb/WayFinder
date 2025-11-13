// LANDING PAGE — concise overview
// Hosts the Map Editor and a small sidebar. Left: upload and edit. Right: account info and a public map URL.
import React, { useEffect} from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import DragMapArea from "./DragMapArea";
import MapEditor from "./MapEditor";
import logo from "./images/logo.png";




function Stat({ label, value }) {
  return (
    <div className="card stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function QuickAction({ label, onClick, kind = "primary" }) {
  const variantMap = {
    primary: "btn btn-primary",
    secondary: "btn btn-secondary",
    ghost: "btn btn-outline-secondary",
    danger: "btn btn-danger",
  };
  const className = variantMap[kind] || variantMap.primary;
  return (
    <button className={className} onClick={onClick}>
      {label}
    </button>
  );
}

// Simple, client-side landing page for authenticated users
// Expects a user object if available; falls back to generic copy
export default function LandingPage({ user }) {
  const navigate = useNavigate();
  const [editorImageUrl, setEditorImageUrl] = React.useState("");
  const [publicMapUrl, setPublicMapUrl] = React.useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("wf_public_map_url")) ||
      ""
  );


  //kris: 
  useEffect(() => {
    const token = localStorage.getItem("token"); 
    if (!token) {
      navigate("/");  // Redirect to SignIn if no token
    }
  }, [navigate]);
  //kris ^


  const savePublicMapUrl = () => {
    try {
      localStorage.setItem("wf_public_map_url", publicMapUrl);
    } catch {}
    alert("Public map URL saved for homepage preview");
  };

  const handleSignOut = () => {
    try {
      localStorage.removeItem("token");
    } catch {}
    navigate("/");
  };

  return (
    <div className="landing">
      <div className="bg-head p-3 rounded mb-5 border-bottom">
        <header
          className="d-flex flex-column flex-md-row justify-content-between 
          align-items-center mb-3 text-center text-md-start"
        >
          <div
            className="display-3 fw-bold text-shadow mb-3 mb-md-0 d-flex align-items-center 
            justify-content-center justify-content-md-start"
          >
            <img src={logo} alt="WayFinder Logo" className="me-2" />
            <span className="text-blue">Way</span>
            <span className="text-orange">Finder</span>
          </div>

          <nav className="d-flex flex-column me-2">
            <button
              className="btn btn-outline-primary fw-bold px-5"
              onClick={() => handleSignOut()}
            >
              Sign Out
            </button>
          </nav>
        </header>
      </div>

      <main className="landing__main container">
        <section className="main-grid">
          <div className="grid-left">
            <div className="card shadow-sm bg-card text-card px-4 py-3 border-4 mb-4">
              <h2 className="">Upload Your Map</h2>
              <p className="">
                Drag an image of your map to preview and save it locally.
              </p>
              <DragMapArea onImageSelected={(url) => setEditorImageUrl(url)} />
            </div>

            <div className="card shadow-sm">
              <h2 className="">
                My opinions on each button will be shown on click (Kaden)
              </h2>
              <div className="actions">
                <QuickAction
                  label="View Uploads"
                  kind="secondary"
                  onClick={() =>
                    alert("Are we just gonna open a file explorer?")
                  }
                />
                <QuickAction
                  label="Preferences"
                  kind="secondary"
                  onClick={() => alert("What is this")}
                />
                <QuickAction
                  label="Help & Docs"
                  kind="ghost"
                  onClick={() => alert("Are we writing docs?")}
                />
              </div>
            </div>

            <div className="mt-3">
              <MapEditor imageSrc={editorImageUrl || publicMapUrl} />
            </div>
          </div>

          <aside className="grid-right">
            <div className="card shadow-sm bg-card text-card px-4 py-3 border-4 mb-4 mt-4">
              <h3 className="card__title">Account Information</h3>
              <div className="">
                <Stat
                  label="Maps Saved - How we do this if its stored locally? Save old paths?"
                  value="—"
                />
                <Stat label="Last Upload - Same here" value="—" />
                <Stat label="Tag" value={user?.tags || "RDP"} />
              </div>
              <p className="muted">
                These values are placeholders until backend wiring is added.
              </p>
            </div>

            <div className="card shadow-sm bg-card text-card px-4 py-3 border-4 mb-4">
              <h3 className="card__title">Account</h3>
              <ul className="list">
                <li>
                  <span className="list__label">Email</span>
                  <span className="list__value">{user?.email || "—"}</span>
                </li>
                <li>
                  <span className="list__label">Role</span>
                  <span className="list__value">User</span>
                </li>
              </ul>
              <div className="actions">
                <QuickAction
                  label="Sign out"
                  kind="danger"
                  onClick={handleSignOut}
                />
              </div>
            </div>

            <div className="card shadow-sm bg-card text-card px-4 py-3 border-4 mb-4">
              <h3 className="">Public Map (Homepage)</h3>
              <p className="c">
                Set the URL of the map image to display on the public homepage.
              </p>
              <div className="field">
                <span className="form-label text-card">Image URL</span>
                <input
                  className="form-control bg-card-inner text-card mt-2"
                  type="url"
                  placeholder="https://example.com/map.png"
                  value={publicMapUrl}
                  onChange={(e) => setPublicMapUrl(e.target.value)}
                />
              </div>
              <div className="actions mt-3">
                <button className="btn btn-success" onClick={savePublicMapUrl}>
                  Save
                </button>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
