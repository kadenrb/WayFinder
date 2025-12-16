// resgistration page — minimal signup for updates
// just a simple form to collect email + tags to sign up for maps 
// connects to backend for storing email + tags
// provides immediate feedback on success/failure and redirects after creation

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

// Base API URL — pulled from environment or defaults to localhost
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

export default function Register() {
  const navigate = useNavigate();
  // Local state for form inputs and feedback
  const [email, setEmail] = useState(""); // user email input
  const [tags, setTags] = useState("RDP"); // optiona tag input
  const [loading, setLoading] = useState(false); // loading indicator for form submission
  const [message, setMessage] = useState(""); // success message
  const [error, setError] = useState(""); // error message

  // Handle form submission
  const onSubmit = async (e) => {
    e.preventDefault(); // prevent page reload
    setError(""); // reset error 
    setMessage(""); // reset success message
    setLoading(true); // show loading state 
    try {
      // Minimal backend tie-in: user signup endpoint
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tags }),
      });
      const data = await res.json();
      // Handle non-OK responses
      if (!res.ok) throw new Error(data?.message || "Registration failed");
      // Show success message
      setMessage("Account created. You can now sign in.");
      // Light nudge to signin after a moment
      setTimeout(() => navigate("/admin/sign-in"), 900);
    } catch (err) {
      setError(err.message || "Unable to register"); // show error message
    } finally {
      setLoading(false); // reset loading state
    }
  };

  return (
    <div className="landing">
      {/* Page header with brand and navigation */}
      <header className="landing__header">
        <div className="brand">
          <span className="brand__name">Wayfinder</span>
        </div>
        <nav className="actions">
          <Link className="btn btn--secondary" to="/">
            Home
          </Link>
        </nav>
      </header>
      {/* Main form area */}
      <main className="landing__main">
        <form className="card auth" onSubmit={onSubmit}>
          <h2 className="card__title">Get Updates</h2>
          <p className="muted">
            Provide your email and a tag to receive updates. This does not
            create a sign-in account.
          </p>
          
          {/* Email input */}
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          {/* Tag input */}
          <label className="field">
            <span className="field__label">Tag</span>
            <input
              className="field__input"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="RDP"
            />
          </label>
          {/* Feedback messages */}
          {message && (
            <div className="success" role="status">
              {message}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {/* Form actions */}
          <div className="actions">
            <button
              className="btn btn--primary"
              type="submit"
              disabled={loading}
            >
              {loading ? "Submitting…" : "Submit"}
            </button>
            <Link className="btn btn--ghost" to="/admin/sign-in">
              Already have an account?
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
