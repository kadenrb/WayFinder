/*
  ENTRY POINT – React wiring and route map for the whole WayFinder frontend.
  - Think of this file as the “mains breaker” for the app: everything
    powers on from here, and if this isn’t wired right, nothing else matters.
  - We:
      • Grab the #root element from index.html and hand it over to React.
      • Wrap the page in BrowserRouter so we can use real URLs instead of
        pretending everything lives on one page.
      • Define the top-level routes that matter to humans:
          - "/"               → Public user-facing map + notify modals (App)
          - "/admin/sign-in"  → Admin login portal for existing admins
          - "/admin/register" → Admin access request form for new locations
          - "/admin/home"     → Admin dashboard / landing after sign-in
          - "/register"       → Regular user registration, if needed later
      • Keep everything inside <React.StrictMode> so React can nag us in dev
        if we’re doing cursed things like side effects in render.
  - If you ever add a new major screen (e.g., /admin/metrics or /demo),
    this is where you plug it into the router so the rest of the app can
    pretend that was always the plan.
*/
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./app";
import SignIn from "./SignIn";
import AdminRegister from "./AdminRegister";
import LandingPage from "./LandingPage";
import Register from "./Register";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin/sign-in" element={<SignIn />} />
        <Route path="/admin/register" element={<AdminRegister />} />
        <Route path="/admin/home" element={<LandingPage />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </Router>
  </React.StrictMode>
);
