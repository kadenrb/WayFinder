import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./app";
import SignIn from "./SignIn";
import AdminRegister from "./AdminRegister";
import LandingPage from "./LandingPage";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin/sign-in" element={<SignIn />} />
        <Route path="/admin/register" element={<AdminRegister />} />
        <Route path="/admin/home" element={<LandingPage />} />
      </Routes>
    </Router>
  </React.StrictMode>
);
