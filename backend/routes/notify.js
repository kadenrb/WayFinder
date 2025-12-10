//Route to send email to all users
const express = require("express");
const nodemailer = require("nodemailer");
// initialize primsa ORM client 
const { PrismaClient } = require("@prisma/client");
// create an express router instacne 
const prisma = new PrismaClient();
const router = express.Router();

// post 
// sends an email to every user in the database
router.post("/", async (req, res) => {
  try {
    // fetch all users (only select email field)
    const users = await prisma.user.findMany({ select: { email: true } });
    // if htere are no users, return 404
    if (!users.length) return res.status(404).json({ error: "No users found" });
    // create an STMP transporter using gmail
    const sender = nodemailer.createTransport({
      service: "gmail",
      auth: {
        // get the email and password from env
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Send email to each user in the loop
    for (const user of users) {
      await sender.sendMail({
        from: "Replace this with the location (RDP)", // update before deplyment 
        to: user.email,
        subject: "Hello from Wayfinder",
        text: "It works!", // plain text 
      });
    }
    // repsond with success and list of email addresses contacted
    res.json({ success: true, emailsSent: users.map((u) => u.email) });
  } catch (err) {
    // log error for debugging 
    console.error(err);
    // generic server error response 
    res.status(500).json({ error: "Something went wrong" });
  }
});
// export the router for use in main server
module.exports = router;
