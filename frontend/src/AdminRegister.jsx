/* 
  High-level overview of this file:
  - This is the "Request Admin Access" screen for WayFinder.
  - It lets an admin-type person submit their company name, email, and a password.
  - On submit, it POSTs those details to the backend /auth/create-admin endpoint.
  - If it works, we show a friendly success message. If it fails, we show an error.
  - We also stash the company name in localStorage so the rest of the admin flows 
    can remember which company they’re managing without asking every time.

  Mental model:
  - Think of this page as a “sign-up request” form, not instant access.
  - The backend gets this, does its checks / approvals, and then eventually emails the user.
*/

import React, { useState } from "react";
import { Link } from "react-router-dom";
import logo from "./images/logo.png";

/* 
  API_URL configuration:
  - We try to read REACT_APP_API_URL from the environment so this can point to:
      - localhost during dev
      - Render / some other host in production
  - If that env var is missing (like on a quick local run), we fall back to http://localhost:5000.
  - This gives us one place to change the backend URL instead of hardcoding it in multiple files.
*/
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

export default function AdminRegister() {
  /* 
    Form + UI state:
    - email / password / company: controlled inputs for the form fields.
    - loading: drives the disabled state + "Submitting…" label on the button so users can’t spam.
    - message: success message when the request went through.
    - error: error message if the backend complained or fetch exploded.

    This is "standard React form state" territory:
    - Everything lives in local component state.
    - Submit handler reads from these values and then decides what to show back to the user.
  */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /* 
    onSubmit handler:
    - Prevents the default browser form submit (no page reload).
    - Clears any previous error/success messages.
    - Sets loading=true so the submit button disables and shows "Submitting…".
    - Stores the company name in localStorage under "wf_admin_company" so later admin screens 
      can pull it and know which org they’re dealing with.
    - Sends a POST to /auth/create-admin with the email, password, and company in JSON.
    - If the response is not OK, it throws so we land in the catch and show a nice error.
    - If it is OK, we show a long-form success message telling the user what happens next.
    - finally: Always flips loading back to false so the button returns to normal.

    TL;DR:
    - This is the one place where we actually talk to the server.
    - Everything else in this component is pure UI and wiring around this function.
  */
  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      // Remember the company locally so the rest of the admin journey can use it.
      localStorage.setItem("wf_admin_company", company);

      const res = await fetch(`${API_URL}/auth/create-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          password: password,
          company: company,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // If backend returns a message, surface that. Otherwise fall back to a generic one.
        throw new Error(data?.message || "Registration failed");
      }

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
    /* 
      Top-level layout:
      - Wraps the whole page in a plain <div> so we can have:
        1) A header bar with logo + navigation links.
        2) A centered card that holds the actual form.
      - All the fancy look-and-feel (colors, spacing, etc.) is handled by Bootstrap and custom classes.
    */
    <div>
      {/* 
        Header section:
        - Shows the WayFinder logo and title in that big, flashy style.
        - Provides quick navigation back to Home and to the Admin Sign-In page.
        - Uses flexbox to:
          - Stack on small screens (mobile).
          - Spread out horizontally on larger screens (desktop).
      */}
      <div className="bg-head p-3 rounded mb-5 border-bottom">
        <header
          className="d-flex flex-column flex-md-row justify-content-between 
          align-items-center mb-3 text-center text-md-start"
        >
          <div
            className="display-3 fw-bold text-shadow mb-3 mb-md-0 d-flex align-items-center 
            justify-content-center justify-content-md-start"
          >
            <img src={logo} alt="WayFinder Logo" className="me-2 logo-img" />
            <span className="text-blue">Way</span>
            <span className="text-orange">Finder</span>
          </div>

          <nav className="d-flex flex-column flex-sm-row gap-2">
            <Link className="btn btn-outline-primary fw-bold px-4" to="/">
              Home
            </Link>
            <Link className="btn btn-primary fw-bold" to="/admin/sign-in">
              Admin Sign In
            </Link>
          </nav>
        </header>
      </div>

      {/* 
        Main content:
        - Centers a card that looks like a clean, official form.
        - Heading explains this is an access *request* (not instant registration).
        - Subtext clarifies that an email goes to the WayFinder creators for approval.
        - Below that is the actual form with:
          - Company name
          - Email address
          - Password with a basic strength rule (8+ chars, at least one number)
      */}
      <main className="d-flex justify-content-center">
        <div className="card shadow-sm p-4 bg-card">
          <h2 className="text-center mb-3 text-orange fw-bold">
            Request Admin Access
          </h2>
          <p className="text-card text-center small mb-4">
            This will send an email to the creators of WayFinder to approve your
            request for a public map in a location you manage.
          </p>

          {/* 
            Admin registration form:
            - onSubmit is wired to our async handler above.
            - Each input is controlled, meaning the value lives in React state
              and updates via onChange.
            - Validation that’s happening here:
              - Required attributes on all fields.
              - Email pattern uses a basic "something@something.something" regex.
              - Password pattern enforces 8+ chars and at least one digit.
            - The API will still do its own validation; this is just client-side guard rails.
          */}
          <form onSubmit={onSubmit}>
            {/* Company field: who they represent / manage */}
            <div className="mb-3">
              <label className="form-label text-card">Company</label>
              <input
                type="text"
                className="form-control bg-card-inner"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Your Company Name"
                required
              />
            </div>

            {/* Email field: contact + login identifier */}
            <div className="mb-3">
              <label className="form-label text-card">Email</label>
              <input
                type="email"
                className="form-control bg-card-inner"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                pattern="[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
                placeholder="admin@example.com"
                required
              />
            </div>

            {/* Password field: basic strength hints so they don’t pick "password123"… well, at least not "password" */}
            <div className="mb-3">
              <label className="form-label text-card">Password</label>
              <input
                type="password"
                className="form-control bg-card-inner"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                pattern="^(?=.*\d).{8,}$"
                title="Must be at least 8 characters long and include at least one number"
              />
              <small className="text-card">
                Password must be at least 8 characters long and include at least
                one number.
              </small>
            </div>

            {/* 
              Feedback area:
              - If we have a success message, show it in a green alert.
              - If we have an error message, show it in a red alert.
              - Only one will usually be visible at a time since we clear both at submit.
            */}
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

            {/* 
              Actions:
              - Primary button: submits the form.
                - Disabled while loading so we don’t double-submit.
                - Label flips to "Submitting…" to give user feedback.
              - Secondary button: takes you back to the Admin Sign-In screen.
            */}
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
