const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

router.post("/signup", async (req, res) => {
  try {
    const { email, tags } = req.body;
    if (!email || tags === undefined) {
      return res.status(400).json({ message: "Email and tags are required" });
    }

    // Create user in database
    const newUser = await prisma.user.create({
      data: {
        email,
        tags, // Prisma expects string for tags now ( this was my issue )
      },
    });

    res.status(201).json({ message: "User created", user: newUser });
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "Failed to save user to db" });
  }
});

router.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) return res.status(401).json({ message: "Admin not found" });

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid)
      return res
        .status(401)
        .json({ message: "Invalid email or password this is my error ?? " });

    const token = jwt.sign({ adminId: admin.id }, JWT_SECRET, {
      expiresIn: "2h",
    });
    res.json({ message: "Admin login successful", token });
  } catch (err) {
    res.status(500).json({ message: "Admin login failed", error: err.message });
  }
});

router.post("/admin/logout", (req, res) => {
  // Since JWTs are stateless, logout can be handled on the client side by simply deleting the token.
  res.json({ message: "Admin logout successful" });
});

router.post("/create-admin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save to database
    const newAdmin = await prisma.admin.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    res.status(201).json({ message: "Admin created", admin: newAdmin });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Error creating admin", error: error.message });
  }
});

module.exports = router;
