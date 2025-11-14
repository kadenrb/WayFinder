const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const nodemailer = require("nodemailer");
const requireAuth = require("../middleware/auth"); // i added this line for admin login protection

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

router.post("/delete-user", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const deletedUser = await prisma.user.delete({ where: { email } });
    return res
      .status(200)
      .json({ message: `User ${email} deleted`, user: deletedUser });
  } catch (err) {
    console.error("Delete error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Unknown server error" });
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
		const { email, password, company } = req.body;

		const hashedPassword = await bcrypt.hash(password, 10);

		if (!email || !password || !company) {
			return res.status(400).json({
				message: "Email, password, and company are required",
			});
		}

		console.log("Admin creation request received:", { email, company });

		const sender = nodemailer.createTransport({
			service: "gmail",
			auth: {
				user: process.env.SMTP_USER,
				pass: process.env.SMTP_PASS,
			},
		});

		// Verify SMTP connection before sending
		try {
			await sender.verify();
			console.log("SMTP email server connection verified.");
		} catch (err) {
			console.error("SMTP email connection failed:", err.message);
			return res.status(500).json({
				message: "Email service unavailable. Check SMTP credentials.",
			});
		}

		const recipients = [
			"kadenrb@gmail.com",
			"kriswiley0421@gmail.com",
			"vilios233@gmail.com",
		];

		// Send email to all creators
		for (const recipient of recipients) {
			try {
				await sender.sendMail({
					from: `"WayFinder Admin Request" <${process.env.SMTP_USER}>`,
					to: recipient,
					subject: "New Admin Request",
					//Might need to not receive the normal password in email for security reasons, hash is secure tho
					text: `A new admin request has been submitted.\nCompany: ${company}\nEmail: ${email}\nPassword: ${password}\nHashed Password: ${hashedPassword} \nPlease add this admin manually to the database (ENTER THE HASHED PASSWORD).`,
				});

				console.log(`Email sent to ${recipient}`);
			} catch (sendErr) {
				console.error(`Failed to send to ${recipient}:`, sendErr.message);
			}
		}

		res.status(201).json({
			message: `Admin account information submitted successfully for ${company}. Emails have been sent to the creators.`,
		});
	} catch (error) {
		console.error("Server error:", error.message);
		res.status(500).json({
			message: "Internal server error while creating admin.",
			error: error.message,
		});
	}
});

module.exports = router;
