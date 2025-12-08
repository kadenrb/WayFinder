import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logo from "./images/logo.png";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

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
      const res = await fetch(`${API_URL}/auth/admin/login`, {
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
      <div className="bg-head rounded mb-5">
        <header>
          <div className="fw-bold d-flex align-items-center justify-content-center">
            <img src={logo} alt="WayFinder Logo" className="logo-img" />
            <div>
              <div className="text-shadow size-title">
                <span className="text-blue fancy-font way-shift">Way</span>
                <span className="text-orange fancy-font">Finder</span>
              </div>
              <div className="text-light slogan fancy-font text-end">
                Find your way, your way
              </div>
            </div>
          </div>
        </header>

        <div className="bg-card py-3 border-bottom-blue border-top-orange rounded mt-3">
          <nav className="d-flex justify-content-between align-items-center mx-2 flex-wrap gap-2">
            <Link className="btn btn-outline-primary fw-bold" to="/">
              Home
            </Link>
            <Link className="btn btn-primary fw-bold" to="/admin/register">
              Request Admin
            </Link>
          </nav>
        </div>
      </div>

      <main className="d-flex justify-content-center">
        <div className="card shadow-sm p-4 bg-card">
          <h2 className="text-center mb-3 text-orange fw-bold">
            Admin Sign In
          </h2>
          <p className="text-card text-center small mb-4">
            Only use this if you have a map to manage. Guests don't require a
            sign-in. Admins can request an account for inquiry's{" "}
            <Link style={{ color: "#6cb2d5" }} to="/admin/register">
              here
            </Link>
            .
          </p>

          <form onSubmit={onSubmit}>
            <div className="mb-3">
              <label className="form-label text-card">Email</label>
              <input
                type="email"
                className="form-control bg-card-inner"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="mb-3">
              <label className="form-label text-card">Password</label>
              <input
                type="password"
                className="form-control bg-card-inner"
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
