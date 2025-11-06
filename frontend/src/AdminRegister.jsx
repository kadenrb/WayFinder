import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logo from "./images/logo.png";

export default function AdminRegister() {
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
        body: JSON.stringify({
          email: email,
          password: password,
          company: company,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Registration failed");
      setMessage(
        `Successfully submitted admin account details for ${company} (email: ${email}). You will receive an email once we have reviewed your request.`
      );
    } catch (err) {
      setError(err.message || "Unable to register admin");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
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

          <nav className="d-flex flex-column flex-sm-row gap-2">
            <Link className="btn btn-outline-primary fw-bold" to="/">
              Home
            </Link>
            <Link className="btn btn-primary fw-bold" to="/admin/sign-in">
              Admin Sign In
            </Link>
          </nav>
        </header>
      </div>

      {/* Main */}
      <main className="d-flex justify-content-center">
        <div className="card shadow-sm p-4">
          <h2 className="text-center mb-3 text-orange fw-bold">
            Request Admin Access
          </h2>
          <p className="text-muted text-center small mb-4">
            This will send an email to the creators of WayFinder to approve your
            request for a public map in a location you manage.
          </p>

          <form onSubmit={onSubmit}>
            <div className="mb-3">
              <label className="form-label">Company</label>
              <input
                type="text"
                className="form-control"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Your Company Name"
                required
              />
            </div>

            <div className="mb-3">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-control"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>

            <div className="mb-3">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {message && (
              <div className="alert alert-success py-2" role="status">
                {message}
              </div>
            )}
            {error && (
              <div className="alert alert-danger py-2" role="alert">
                {error}
              </div>
            )}

            <div className="d-grid gap-2 mt-4">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "Submitting…" : "Create Admin"}
              </button>
              <Link to="/admin/sign-in" className="btn btn-outline-primary">
                Back to Sign In
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
