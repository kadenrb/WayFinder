import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MapPreview from "./MapPreview";

export default function HomePage() {
  const [showTagModal, setShowTagModal] = useState(false);
  const [tag, setTag] = useState("");
  const publicMapUrl = typeof window !== "undefined" ? localStorage.getItem("wf_public_map_url") || "" : "";

  useEffect(() => {
    const done = typeof window !== "undefined" && localStorage.getItem("wf_tags");
    if (!done) setShowTagModal(true);
  }, []);

  const saveTag = () => {
    try {
      localStorage.setItem("wf_tags", tag || "RDP");
    } catch {}
    setShowTagModal(false);
  };

  return (
    <div className="landing">
      <header className="landing__header">
        <div className="brand">
          <span className="brand__logo" aria-hidden></span>
          <span className="brand__name">Wayfinder</span>
        </div>
        <nav className="actions">
          <Link className="btn btn--secondary" to="/signin">Admin Sign In</Link>
          <Link className="btn btn--primary" to="/register">Get Updates</Link>
        </nav>
      </header>

      <main className="landing__main container">
        <section className="hero card shadow-sm">
          <h1 className="hero__title">Find your way with Wayfinder</h1>
          <p className="hero__subtitle">Upload maps, preview instantly, and get going - no fuss.</p>
          <div className="actions">
            <Link className="btn btn--primary" to="/signin">Admin Sign In</Link>
            <Link className="btn btn--ghost" to="/register">Get updates</Link>
            <Link className="btn btn--secondary" to="/app">Continue without signing in</Link>
          </div>
        </section>

        <section className="card shadow-sm">
          <h2 className="card__title">Current Map</h2>
          <p className="card__desc">This is the public map set by an admin.</p>
          <MapPreview imageUrl={publicMapUrl} />
        </section>

        <section className="card shadow-sm">
          <h2 className="card__title">What you can do</h2>
          <ul className="list">
            <li>Drag-and-drop your map image for a quick preview</li>
            <li>Save locally with one click</li>
            <li>More to come: uploads view, preferences, and sharing</li>
          </ul>
        </section>
      </main>

      {showTagModal && (
        <div className="modal">
          <div className="modal__backdrop" onClick={() => setShowTagModal(false)} />
          <div className="modal__content">
            <h3 className="card__title">Pick a notification tag</h3>
            <p className="muted">Choose a tag to receive updates for specific areas.</p>
            <div className="field" style={{ marginTop: 8 }}>
              <span className="field__label">Tag</span>
              <input className="field__input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="RDP" />
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn btn--primary" onClick={saveTag}>Save</button>
              <button className="btn btn--ghost" onClick={() => setShowTagModal(false)}>Skip</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
