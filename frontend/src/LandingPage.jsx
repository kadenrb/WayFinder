// LANDING PAGE — concise overview
// Hosts the Map Editor and a small sidebar. Left: upload and edit. Right: account info and a public map URL.
import React from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
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
  // Multi-image working set kept in memory for this session (multi-floor editing)
  const [images, setImages] = React.useState([]); // [{id,name,url,size}]
  const [selectedImageId, setSelectedImageId] = React.useState(null);
  // Removed: legacy public map URL card (public viewer now uses published floors)

  // Simple id generator local to this module
  // Simple id generator local to this module
  const uid = () => Math.random().toString(36).slice(2, 10);

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
  function publishPublicFloors() {
    try {
      const floors = images.map((img) => {
        const raw = localStorage.getItem(`wf_map_editor_state:${img.url || ''}`);
        const state = raw ? JSON.parse(raw) : {};
        return {
          id: img.id,
          name: img.name || 'floor',
          url: img.url,
          points: Array.isArray(state?.points) ? state.points : [],
          walkable: state?.walkable || { color: '#9F9383', tolerance: 12 },
        };
      });
      localStorage.setItem('wf_public_floors', JSON.stringify({ floors }));
      alert(`Published ${floors.length} floor(s) to public viewer`);
    } catch (e) {
      alert('Failed to publish floors');
    }
  }

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
                <button className="btn btn-primary" onClick={publishPublicFloors} disabled={!images.length}>Publish Floors</button>
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
              <MapEditor imageSrc={(selectedImage && selectedImage.url) || ""} />
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

            {/* Removed: Public Map (Homepage) card; user viewer handles floors */}
          </aside>
        </section>
      </main>
    </div>
  );
}
