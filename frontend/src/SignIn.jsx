import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Minimal backend tie-in: admin login endpoint
      const res = await fetch("http://localhost:5000/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Sign-in failed");
      if (data?.token) localStorage.setItem("token", data.token);
      navigate("/admin/home");
    } catch (err) {
      setError(err.message || "Unable to sign in");
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
          <Link className="btn btn--ghost" to="/admin/register">
            Request Admin
          </Link>
        </nav>
      </header>

      <main className="landing__main">
        <form className="card auth" onSubmit={onSubmit}>
          <h2 className="card__title">Admin Sign In</h2>
          <p className="muted">
            Only administrators can sign in. Public users can browse without an
            account.
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
            <span className="field__label">Password</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
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
              {loading ? "Signing in…" : "Sign In"}
            </button>
            <Link className="btn btn--ghost" to="/register">
              Get updates
            </Link>
            <Link className="btn btn--secondary" to="/admin/home">
              Continue without sign in
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
