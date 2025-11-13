const express = require("express");

const cors = require("cors");

const authRoutes = require("./routes/auth");

const notifyRoutes = require("./routes/notify");

const app = express();

app.use(cors()); // Allow frontend to access backend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/auth", authRoutes);

// app.use("/upload", uploadRoute);

app.use("/notify", notifyRoutes);

//Start server
app.listen(5000, () => console.log("Server running on port 5000"));
