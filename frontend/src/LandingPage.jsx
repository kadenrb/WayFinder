// LANDING PAGE — concise overview
// Hosts the Map Editor and a small sidebar. Left: upload and edit. Right: account info and a public map URL.
import React, { useEffect} from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
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
  const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
  // Multi-image working set kept in memory for this session (multi-floor editing)
  const [images, setImages] = React.useState([]); // [{id,name,url,size}]
  const [selectedImageId, setSelectedImageId] = React.useState(null);
  const [publishedFloors, setPublishedFloors] = React.useState([]);
  const [publishing, setPublishing] = React.useState(false);
  const [publishMsg, setPublishMsg] = React.useState("");
  const [loadingPublished, setLoadingPublished] = React.useState(false);
  // Removed: legacy public map URL card (public viewer now uses published floors)

  // Simple id generator local to this module
  // Simple id generator local to this module
  const uid = () => Math.random().toString(36).slice(2, 10);

  const objectUrlToDataUrl = async (url) => {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  };

  const fetchPublishedFloors = React.useCallback(async () => {
    setLoadingPublished(true);
    try {
      const res = await fetch(`${API_URL}/floors`);
      if (!res.ok) throw new Error("Failed to fetch floors");
      const data = await res.json();
      setPublishedFloors(Array.isArray(data?.floors) ? data.floors : []);
    } catch (err) {
      console.error("Failed to load published floors", err);
      setPublishMsg("Unable to load published floors.");
      setTimeout(() => setPublishMsg(""), 4000);
    } finally {
      setLoadingPublished(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchPublishedFloors();
  }, [fetchPublishedFloors]);

  // Add images chosen by the admin (supports multiple files)
  const addImages = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith("image/"));
    if (!files.length) return;
    const created = files.map((f) => ({ id: uid(), name: f.name || "map.png", url: URL.createObjectURL(f), size: f.size || 0 }));
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
      try { URL.revokeObjectURL(prev[idx].url); } catch {}
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
    setImages((prev) => { prev.forEach((i) => { try { URL.revokeObjectURL(i.url); } catch {} }); return []; });
    setSelectedImageId(null);
  };

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
      navigate("/"); // Redirect to SignIn if no token
    }
  }, [navigate]);
  //kris ^

  const savePublicMapUrl = () => {
    try {
      localStorage.setItem("wf_public_map_url", publicMapUrl);
    } catch {}
    alert("Public map URL saved for homepage preview");
  };

  const deletePublishedFloor = async (id) => {
    if (!window.confirm("Remove this published floor?")) return;
    try {
      const res = await fetch(`${API_URL}/floors/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setPublishedFloors((prev) => prev.filter((f) => f.id !== id));
      setPublishMsg("Floor removed.");
    } catch (err) {
      console.error(err);
      setPublishMsg("Failed to remove floor.");
    } finally {
      setTimeout(() => setPublishMsg(""), 4000);
    }
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
    (Array.isArray(aState?.points) ? aState.points : []).forEach(p => {
      if (p?.kind === 'poi' && (p.poiType === 'stairs' || p.poiType === 'elevator') && typeof p.warpKey === 'string' && p.warpKey.trim()) a.add(p.warpKey.trim());
    });
    (Array.isArray(bState?.points) ? bState.points : []).forEach(p => {
      if (p?.kind === 'poi' && (p.poiType === 'stairs' || p.poiType === 'elevator') && typeof p.warpKey === 'string' && p.warpKey.trim()) b.add(p.warpKey.trim());
    });
    const out = [];
    for (const k of a) if (b.has(k)) out.push(k);
    return out;
  }

  function writeUserPosFor(url, pos) {
    try {
      const key = `wf_map_editor_state:${url || ''}`;
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
  async function publishPublicFloors() {
    if (!images.length) return;
    setPublishing(true);
    setPublishMsg("Publishing floors...");
    try {
      const floors = await Promise.all(
        images.map(async (img, index) => {
          const raw = localStorage.getItem(`wf_map_editor_state:${img.url || ""}`);
          const state = raw ? JSON.parse(raw) : {};
          const imageData = await objectUrlToDataUrl(img.url);
          return {
            name: img.name || `Floor ${index + 1}`,
            imageData,
            points: Array.isArray(state?.points) ? state.points : [],
            walkable: state?.walkable || { color: "#9F9383", tolerance: 12 },
            sortOrder: index,
          };
        })
      );
      localStorage.setItem(
        "wf_public_floors",
        JSON.stringify({
          floors: floors.map((f) => ({ ...f, url: f.imageData })),
        })
      );
      const res = await fetch(`${API_URL}/floors/publish`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floors }),
      });
      if (!res.ok) throw new Error("Server rejected floors");
      const data = await res.json();
      setPublishedFloors(Array.isArray(data?.floors) ? data.floors : []);
      setPublishMsg(`Published ${floors.length} floor(s).`);
      alert(`Published ${floors.length} floor(s) to public viewer`);
    } catch (e) {
      console.error(e);
      setPublishMsg("Failed to publish floors.");
      alert("Failed to publish floors");
    } finally {
      setPublishing(false);
      setTimeout(() => setPublishMsg(""), 4000);
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
            <div className="card shadow-sm">
              <h2 className="card__title">Multi-Floor Images</h2>
              <p className="card__desc">Upload multiple floor images and switch between them while editing.</p>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <label className="btn btn-secondary">
                  Add Images
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />
                </label>
                <button className="btn btn-outline-secondary" onClick={() => selectNext(-1)} disabled={!images.length}>Prev</button>
                <button className="btn btn-outline-secondary" onClick={() => selectNext(+1)} disabled={!images.length}>Next</button>
                <button className="btn btn-outline-danger" onClick={clearAllImages} disabled={!images.length}>Clear All</button>
                {/* Removed: Plan Cross-floor Route (dev aid) */}
                <button className="btn btn-primary" onClick={publishPublicFloors} disabled={!images.length || publishing}>
                  {publishing ? "Publishing..." : "Publish Floors"}
                </button>
              </div>
              {images.length === 0 && (
                <p className="muted mt-2">No images yet. Click "Add Images" and choose multiple files.</p>
              )}
              {images.length > 0 && (
                <ul className="list mt-3">
                  {images.map((img, i) => (
                    <li key={img.id} className="d-flex justify-content-between align-items-center">
                      <span style={{ cursor: 'pointer' }} onClick={() => setSelectedImageId(img.id)}>
                        {selectedImageId === img.id ? <strong>{i+1}. {img.name}</strong> : <>{i+1}. {img.name}</>}
                      </span>
                      <span className="d-flex align-items-center gap-2">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => setSelectedImageId(img.id)}>Select</button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => removeImage(img.id)}>Remove</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card shadow-sm mt-4">
              <div className="d-flex justify-content-between align-items-center">
                <h2 className="card__title mb-0">Published Floors</h2>
                <button className="btn btn-sm btn-outline-secondary" onClick={fetchPublishedFloors} disabled={loadingPublished}>
                  {loadingPublished ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {publishMsg && <p className="text-muted small mt-2 mb-0">{publishMsg}</p>}
              {loadingPublished && <p className="muted mt-2">Loading…</p>}
              {!loadingPublished && publishedFloors.length === 0 && (
                <p className="muted mt-2">No floors published yet.</p>
              )}
              {!loadingPublished && publishedFloors.length > 0 && (
                <ul className="list mt-3">
                  {publishedFloors.map((floor) => (
                    <li key={floor.id} className="d-flex justify-content-between align-items-center">
                      <span className="d-flex flex-column">
                        <strong>{floor.name}</strong>
                        <small className="text-muted">ID: {floor.id}</small>
                      </span>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => deletePublishedFloor(floor.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
              <MapEditor imageSrc={(selectedImage && selectedImage.url) || ""} />
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
};

