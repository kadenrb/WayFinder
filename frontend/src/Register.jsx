import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState("RDP");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      // Minimal backend tie-in: user signup endpoint
      const res = await fetch("http://localhost:5000/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Registration failed");
      setMessage("Account created. You can now sign in.");
      // Light nudge to signin after a moment
      setTimeout(() => navigate("/signin"), 900);
    } catch (err) {
      setError(err.message || "Unable to register");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing">
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

      <main className="landing__main">
        <form className="card auth" onSubmit={onSubmit}>
          <h2 className="card__title">Get Updates</h2>
          <p className="muted">
            Provide your email and a tag to receive updates. This does not
            create a sign-in account.
          </p>
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
          <div className="actions">
            <button
              className="btn btn--primary"
              type="submit"
              disabled={loading}
            >
              {loading ? "Submitting…" : "Submit"}
            </button>
            <Link className="btn btn--ghost" to="/signin">
              Already have an account?
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
