const express = require("express");

const cors = require("cors");

const authRoutes = require("./routes/auth");

const notifyRoutes = require("./routes/notify");

const adminRoutes = require("./routes/admin");

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  "https://wayfinderfront.onrender.com",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
); // Allow frontend to access backend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/auth", authRoutes);

app.use("/admin", adminRoutes);

app.use("/notify", notifyRoutes);

//Start server
app.listen(5000, () => console.log("Server running on port 5000"));
