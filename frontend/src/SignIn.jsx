import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logo from "./images/logo.png";

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
    <div className="">
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
            <Link className="btn btn-primary fw-bold" to="/admin/register">
              Request Admin
            </Link>
          </nav>
        </header>
      </div>

      <main className="d-flex justify-content-center">
        <div className="card shadow-sm p-4">
          <h2 className="text-center mb-3 text-orange fw-bold">
            Admin Sign In
          </h2>
          <p className="text-muted text-center small mb-4">
            Only use this if you have a map to manage. Guests don't require a
            sign-in. Admins can request an account for inquiry's{" "}
            <Link to="/admin/register">here</Link>.
          </p>

          <form onSubmit={onSubmit}>
            <div className="mb-3">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-control"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
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
                placeholder="***"
                required
              />
            </div>

            {error && (
              <div className="alert alert-danger py-2" role="alert">
                {error}
              </div>
            )}

            <div className="d-grid gap-2 mt-4">
              <button type="submit" className="btn btn-primary">
                Sign In
              </button>
              <Link to="/" className="btn btn-outline-primary">
                Home
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
