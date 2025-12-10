// Import express to create router 
const express = require("express");
// Import auth middeleware 
const authController = require("../controllers/authController");
// Import Prisma Client to interact with the database
const { PrismaClient } = require("@prisma/client");
// Initalize prisma client 
const prisma = new PrismaClient();
// create an express router instance 
const router = express.Router();

/*
* protected route : GET /me
* requires authenticaion via authController middleware
* verifies JWT token, and attaches the adminID to req.adminID
*/


router.get("/me", authController, async (req, res) => {
  try {
    // look up the authenticated admin using the ID stored in the jwt payload
    const admin = await prisma.admin.findUnique({
      where: { id: req.adminId }, // must match token payload
      select: { email: true, tags: true }, // only return safe fields
    });

    //if no admin exists, return 404 admin not found
    if (!admin) return res.status(404).json({ error: "Admin not found" });
    // return admin profile data 
    res.json(admin);
    // log error for debugging
  } catch (err) {
    console.error(err);
    // error message for server errors 
    res.status(500).json({ error: "Server error" });
  }
});

// export the router so it can be used in other parts of the application
module.exports = router;
