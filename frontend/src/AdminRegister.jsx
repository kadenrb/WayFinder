import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function AdminRegister() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      localStorage.setItem("wf_admin_company", company);
      const res = await fetch("http://localhost:5000/auth/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Registration failed");
      setMessage("Admin account created. You can now sign in.");
      setTimeout(() => navigate("/admin/sign-in"), 900);
    } catch (err) {
      setError(err.message || "Unable to register admin");
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
          <Link className="btn btn--ghost" to="/admin/sign-in">
            Admin Sign In
          </Link>
        </nav>
      </header>

      <main className="landing__main">
        <form className="card auth" onSubmit={onSubmit}>
          <h2 className="card__title">Request Admin Access</h2>
          <p className="muted">
            Create an admin account. Company name is for display only.
          </p>
          <label className="field">
            <span className="field__label">Company</span>
            <input
              className="field__input"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Inc."
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
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
              {loading ? "Submitting…" : "Create Admin"}
            </button>
            <Link className="btn btn--ghost" to="/signin">
              Back to Sign In
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
