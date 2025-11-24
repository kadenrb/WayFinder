const express = require("express");
const authController = require("../controllers/authController");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const router = express.Router();

// Protected route
router.get("/me", authController, async (req, res) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.adminId }, // must match token payload
      select: { email: true, tags: true },
    });

    if (!admin) return res.status(404).json({ error: "Admin not found" });

    res.json(admin);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
