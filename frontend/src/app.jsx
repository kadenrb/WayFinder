import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./HomePage";
import LandingPage from "./LandingPage";
import SignIn from "./SignIn";
import Register from "./Register";
import AdminRegister from "./AdminRegister";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/register" element={<Register />} />
        <Route path="/admin/register" element={<AdminRegister />} />
        <Route path="/app" element={<LandingPage user={null} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
