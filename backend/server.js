const express = require("express");
const { PrismaClient } = require("./generated/prisma");
const cors = require("cors");

const path = require("path");
const authRoutes = require("./routes/auth");
const uploadRoute = require("./routes/upload");
const notifyRoutes = require("./routes/notify");

const app = express();
const prisma = new PrismaClient();

app.use(cors()); // Allow frontend to access backend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(process.cwd(), "/uploads")));

app.use("/auth", authRoutes);

app.use("/upload", uploadRoute);

app.use("/notify", notifyRoutes);

//Start server
app.listen(5000, () => console.log("Server running on port 5000"));
