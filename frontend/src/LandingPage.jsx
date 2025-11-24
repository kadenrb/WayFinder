// LANDING PAGE — concise overview
// Hosts the Map Editor and a small sidebar. Left: upload and edit. Right: account info and a public map URL.
import React, { useEffect } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import MapEditor from "./MapEditor";
import logo from "./images/logo.png";

// Simple, client-side landing page for authenticated users
// Expects a user object if available; falls back to generic copy
export default function LandingPage({ user }) {
  const navigate = useNavigate();
  // Multi-image working set kept in memory for this session (multi-floor editing)
  const [images, setImages] = React.useState([]); // [{id,name,url,size}]
  const [selectedImageId, setSelectedImageId] = React.useState(null);

  // Set up admin state
  const [admin, setAdmin] = useState(null);

  // Simple id generator local to this module
  const uid = () => Math.random().toString(36).slice(2, 10);

  // Add images chosen by the admin (supports multiple files)
  const addImages = (fileList) => {
    const files = Array.from(fileList || []).filter(
      (f) => f && f.type && f.type.startsWith("image/")
    );
    if (!files.length) return;
    const created = files.map((f) => ({
      id: uid(),
      name: f.name || "map.png",
      url: URL.createObjectURL(f),
      size: f.size || 0,
    }));
    setImages((prev) => {
      const next = [...prev, ...created];
      if (!selectedImageId && next.length > 0) setSelectedImageId(next[0].id);
      return next;
    });
  };

  // Remove a single image and revoke its object URL
  const removeImage = (id) => {
    setImages((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return prev;
      try {
        URL.revokeObjectURL(prev[idx].url);
      } catch {}
      const next = prev.slice(0, idx).concat(prev.slice(idx + 1));
      // Adjust selection
      if (selectedImageId === id) {
        const fallback = next[idx] || next[idx - 1] || next[0] || null;
        setSelectedImageId(fallback ? fallback.id : null);
      }
      return next;
    });
  };

  // Clear all images in this working session
  const clearAllImages = () => {
    setImages((prev) => {
      prev.forEach((i) => {
        try {
          URL.revokeObjectURL(i.url);
        } catch {}
      });
      return [];
    });
    setSelectedImageId(null);
  };

  const [editorImageUrl, setEditorImageUrl] = React.useState("");
  const [publicMapUrl, setPublicMapUrl] = React.useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("wf_public_map_url")) ||
      ""
  );

  useEffect(() => {
    const token = localStorage.getItem("token");
    console.log("Token in LandingPage:", token); // Debug log
    if (!token) {
      navigate("/"); // redirect if no token
      return;
    }

    async function fetchAdmin() {
      try {
        const res = await fetch("http://localhost:5000/admin/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) throw new Error("Failed to fetch admin");

        const data = await res.json();
        setAdmin(data); // update state, now component can render
      } catch (err) {
        console.error("Fetch admin failed:", err);
        localStorage.removeItem("token");
        navigate("/"); // redirect if fetch fails
      }
    }

    fetchAdmin();
  }, [navigate]);

  const savePublicMapUrl = () => {
    try {
      localStorage.setItem("wf_public_map_url", publicMapUrl);
    } catch {}
    alert("Public map URL saved for homepage preview");
  };

  // Cycle selection forward/backward
  const selectNext = (dir = +1) => {
    if (!images.length || !selectedImageId) return;
    const idx = images.findIndex((i) => i.id === selectedImageId);
    if (idx === -1) return;
    const ni = (idx + dir + images.length) % images.length;
    setSelectedImageId(images[ni].id);
  };

  const selectedImage = images.find((i) => i.id === selectedImageId) || null;

  // Build a warp registry and suggest a cross-floor route plan
  // Removed: dev-only cross-floor helpers (now user-side only)

  function sharedWarpKeys(aState, bState) {
    const a = new Set();
    const b = new Set();
    (Array.isArray(aState?.points) ? aState.points : []).forEach((p) => {
      if (
        p?.kind === "poi" &&
        (p.poiType === "stairs" || p.poiType === "elevator") &&
        typeof p.warpKey === "string" &&
        p.warpKey.trim()
      )
        a.add(p.warpKey.trim());
    });
    (Array.isArray(bState?.points) ? bState.points : []).forEach((p) => {
      if (
        p?.kind === "poi" &&
        (p.poiType === "stairs" || p.poiType === "elevator") &&
        typeof p.warpKey === "string" &&
        p.warpKey.trim()
      )
        b.add(p.warpKey.trim());
    });
    const out = [];
    for (const k of a) if (b.has(k)) out.push(k);
    return out;
  }

  function writeUserPosFor(url, pos) {
    try {
      const key = `wf_map_editor_state:${url || ""}`;
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : {};
      data.userPos = { x: pos.x, y: pos.y };
      localStorage.setItem(key, JSON.stringify(data));
    } catch {}
  }

  // Debounced proximity watcher to auto-switch floors when reaching a warp
  // Removed: auto cross-floor dev effect
  // Removed: planCrossFloorRoute dev helper

  // Publish current floors + points/walkable to public viewer
  function publishPublicFloors() {
    try {
      const floors = images.map((img) => {
        const raw = localStorage.getItem(
          `wf_map_editor_state:${img.url || ""}`
        );
        const state = raw ? JSON.parse(raw) : {};
        return {
          id: img.id,
          name: img.name || "floor",
          url: img.url,
          points: Array.isArray(state?.points) ? state.points : [],
          walkable: state?.walkable || { color: "#9F9383", tolerance: 12 },
        };
      });
      localStorage.setItem("wf_public_floors", JSON.stringify({ floors }));
      alert(`Published ${floors.length} floor(s) to public viewer`);
    } catch (e) {
      alert("Failed to publish floors");
    }
  }

  const handleSignOut = () => {
    try {
      localStorage.removeItem("token");
    } catch {}
    navigate("/");
  };

  return (
    <div className="landing">
      <div className="bg-head p-3 rounded mb-3 border-bottom">
        <header
          className="d-flex flex-column flex-md-row justify-content-between 
          align-items-center mb-3 text-center text-md-start"
        >
          <div
            className="display-3 fw-bold text-shadow d-flex align-items-center 
            justify-content-center justify-content-md-start"
          >
            <img src={logo} alt="WayFinder Logo" className="me-2 logo-img" />
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

      <div className="d-flex justify-content-center">
        <div className="text-center mb-5 mt-4 card shadow-sm bg-card text-card h3 border-4 d-inline-block py-3 rounded-pill px-5">
          {admin ? (
            <>
              Welcome,{" "}
              <span className="text-orange fw-bold">{admin.email}</span>. You
              are currently managing maps for{" "}
              <span className="text-orange fw-bold">{admin.tags}</span>.
            </>
          ) : (
            "Loading..."
          )}
        </div>
      </div>

      <main className="container-fluid">
        <section className="justify-content-center d-grid">
          <div className="card shadow-sm bg-card text-card px-4 py-3 mb-5 border-4 text-center rounded-5">
            <h2 className="fw-bold border-bottom border-2 border-blue rounded-3 pb-3 mb-0 text-shadow-sm">
              Multi-Floor Images
            </h2>
            <p className="border-top border-2 border-blue rounded-3 pt-3 mt-0">
              Upload multiple floor images and switch between them while
              editing.
            </p>
            <div className="d-flex justify-content-center gap-4 align-items-center mt-3 mb-4 flex-wrap">
              <label className="btn btn-success">
                Add Images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    addImages(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>

              <button
                className="btn btn-primary"
                onClick={publishPublicFloors}
                disabled={!images.length}
              >
                Publish Floors
              </button>

              <button
                className="btn btn-danger"
                onClick={clearAllImages}
                disabled={!images.length}
              >
                Clear All
              </button>
            </div>
            <div className="gap-2 d-flex justify-content-center mb-3 justify-content-center gap-4 flex-wrap">
              <button
                className="btn btn-secondary"
                onClick={() => selectNext(-1)}
                disabled={!images.length}
              >
                Prev img
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => selectNext(+1)}
                disabled={!images.length}
              >
                Next img
              </button>
            </div>

            {images.length === 0 && (
              <p className="text-card mt-5">
                No images yet. Click "Add Images" and choose multiple files.
              </p>
            )}
            {images.length > 0 && (
              <ul className="list mt-3">
                {images.map((img, i) => (
                  <li
                    key={img.id}
                    className="d-flex justify-content-between align-items-center flex-wrap"
                  >
                    <span
                      style={{ cursor: "pointer", minWidth: 0, flexShrink: 1 }}
                      onClick={() => setSelectedImageId(img.id)}
                    >
                      {selectedImageId === img.id ? (
                        <strong>
                          {i + 1}. {img.name}
                        </strong>
                      ) : (
                        <>
                          {i + 1}. {img.name}
                        </>
                      )}
                    </span>
                    <span className="d-flex align-items-center gap-2">
                      <button
                        className="btn btn-sm btn-success"
                        onClick={() => setSelectedImageId(img.id)}
                      >
                        Select
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => removeImage(img.id)}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="map-editor-container mb-5">
            <MapEditor imageSrc={selectedImage?.url || ""} />
          </div>

          <aside>
            <div className="card shadow-sm bg-card text-card px-4 py-3 border-4 mb-4 justify-content-center text-center rounded-5">
              <h3 className="border-bottom border-2 border-blue rounded-3 pb-3 mb-0 fw-bold text-shadow-sm">
                Public Map (Homepage)
              </h3>
              <p className="border-top border-2 border-blue rounded-3 pt-3 mt-0">
                Set the URL of the map image to display on the public homepage.
              </p>
              <div className="field">
                <span className="form-label text-card">Image URL</span>
                <input
                  className="form-control bg-card-inner text-card mt-2 text-center"
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
