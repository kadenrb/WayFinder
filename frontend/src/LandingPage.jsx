// LANDING PAGE — concise overview
// Hosts the Map Editor and a small sidebar. Left: upload and edit. Right: account info and a public map URL.
import React from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import DragMapArea from "./DragMapArea";
import MapEditor from "./MapEditor";

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
  const name = user?.name || user?.email || "Explorer";
  const navigate = useNavigate();
  const [editorImageUrl, setEditorImageUrl] = React.useState("");
  const [publicMapUrl, setPublicMapUrl] = React.useState(() =>
    (typeof window !== "undefined" && localStorage.getItem("wf_public_map_url")) || ""
  );

  const savePublicMapUrl = () => {
    try { localStorage.setItem("wf_public_map_url", publicMapUrl); } catch {}
    alert("Public map URL saved for homepage preview");
  };

  const handleSignOut = () => {
    try { localStorage.removeItem("token"); } catch {}
    navigate("/");
  };

  return (
    <div className="landing">
      <header className="d-flex justify-content-between align-items-center p-1 bg-head border-bottom">
        <div className="brand">
          <span className="brand__logo" aria-hidden></span>
          <span className="brand__name text-white fw-bold">Wayfinder</span>
        </div>
        <h1 className="title text-2xl fw-bold text-center text-white m-0">
          Welcome, {name}
        </h1>
        <button className="btn btn-primary fw-bold" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      <main className="landing__main container">
        <section className="main-grid">
          <div className="grid-left">
            <div className="card shadow-sm">
              <h2 className="card__title">Upload Your Map</h2>
              <p className="card__desc">
                Drag an image of your map to preview and save it locally.
              </p>
              <DragMapArea onImageSelected={(url) => setEditorImageUrl(url)} />
            </div>

            <div className="card shadow-sm">
              <h2 className="card__title">Quick Actions</h2>
              <div className="actions">
                <QuickAction
                  label="View Uploads"
                  kind="secondary"
                  onClick={() => alert("Coming soon: uploads view")}
                />
                <QuickAction
                  label="Preferences"
                  kind="secondary"
                  onClick={() => alert("Coming soon: preferences")}
                />
                <QuickAction
                  label="Help & Docs"
                  kind="ghost"
                  onClick={() => alert("Coming soon: docs")}
                />
              </div>
            </div>

            <div className="mt-3">
              <MapEditor imageSrc={editorImageUrl || publicMapUrl} />
            </div>
          </div>

                    <aside className="grid-right">
            <div className="card shadow-sm">
              <h3 className="card__title">Your Overview</h3>
              <div className="stats">
                <Stat label="Maps Saved" value="—" />
                <Stat label="Last Upload" value="—" />
                <Stat label="Tag" value={user?.tags || "RDP"} />
              </div>
              <p className="muted">
                These values are placeholders until backend wiring is added.
              </p>
            </div>

            <div className="card shadow-sm">
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

            <div className="card shadow-sm">
              <h3 className="card__title">Public Map (Homepage)</h3>
              <p className="card__desc">Set the URL of the map image to display on the public homepage.</p>
              <div className="field">
                <span className="field__label">Image URL</span>
                <input
                  className="field__input"
                  type="url"
                  placeholder="https://example.com/map.png"
                  value={publicMapUrl}
                  onChange={(e) => setPublicMapUrl(e.target.value)}
                />
              </div>
              <div className="actions" style={{ marginTop: 10 }}>
                <QuickAction label="Save" onClick={savePublicMapUrl} />
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
