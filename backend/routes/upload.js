// const express = require("express");
// const multer = require("multer");
// const path = require("path");
// const fs = require("fs");
// const requireAuth = require("../middleware/auth.js"); // <-- no {}

// const router = express.Router();

// const uploadBase = "uploads/";

// // Ensure upload directory exists
// if (!fs.existsSync(uploadBase)) {
// 	fs.mkdirSync(uploadBase);
// }

// const storage = multer.diskStorage({
// 	destination: function (req, file, cb) {
// 		const userId = req.user?.userId || "public";
// 		const dir = path.join(uploadBase, `user_${userId}`);
// 		if (!fs.existsSync(dir)) {
// 			fs.mkdirSync(dir, { recursive: true });
// 		}
// 		cb(null, dir);
// 	},
// 	filename: function (req, file, cb) {
// 		cb(null, Date.now() + "-" + file.originalname);
// 	},
// });

// const upload = multer({ storage });

// console.log("Type of requireAuth:", typeof requireAuth);
// console.log("Type of upload.single:", typeof upload.single);

// router.post("/", requireAuth, upload.single("map"), async (req, res) => {
// 	try {
// 		if (!req.file) {
// 			return res.status(400).json({ error: "No file uploaded" });
// 		}

// 		const { mapName } = req.body;
// 		const fileUrl = `/uploads/user_${req.user.userId}/${req.file.filename}`;

// 		res.status(201).json({
// 			message: "File uploaded successfully",
// 			fileUrl,
// 		});
// 	} catch (error) {
// 		console.error(error);
// 		res.status(500).json({ error: "Upload failed, please try again" });
// 	}
// });

// module.exports = router;
