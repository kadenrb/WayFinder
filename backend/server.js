// import express framework 
const express = require("express");
// import cors middleware to handle cross-orgin requests 
const cors = require("cors");
// Import route modules 
const authRoutes = require("./routes/auth");
const notifyRoutes = require("./routes/notify");
const storageRoutes = require("./routes/storage");

const adminRoutes = require("./routes/admin");
// create an express application instance 
const app = express();

// define a list of allowed origins for cors 
// includes local development URLS, envrioment variable URLs, and production frontend
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  "https://wayfinderfront.onrender.com",
].filter(Boolean);// remove any undefined or falsy values
// configure cors middleware 
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non browser requests like postman
      if (allowedOrigins.includes(origin)) return callback(null, true); // allow if in whitelist 
      return callback(new Error("Not allowed by CORS")); // block otherwise 
    },
    credentials: true, // allow cookies and credentials to be sent 
  })
);
// parse incoming json request bodies 
app.use(express.json());
// parse URL encoded request bodies (from forms)
app.use(express.urlencoded({ extended: true }));
// mount route modules
app.use("/auth", authRoutes); // authentication routes

app.use("/admin", adminRoutes); // admin routes

app.use("/notify", notifyRoutes); // notification routes
app.use("/storage", storageRoutes); // storage routes / S3 routes 

//Start server on port 5000
app.listen(5000, () => console.log("Server running on port 5000"));
