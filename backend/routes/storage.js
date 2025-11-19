const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const {
  S3_ACCESS_KEY,
  S3_SECRET_KEY,
  S3_REGION,
  S3_BUCKET,
  S3_PUBLIC_BASE_URL,
} = process.env;

const hasS3Config =
  S3_ACCESS_KEY && S3_SECRET_KEY && S3_REGION && S3_BUCKET;

const s3Client = hasS3Config
  ? new S3Client({
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
    })
  : null;

const resolvePublicUrl = (key) => {
  if (S3_PUBLIC_BASE_URL) {
    return `${S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
};

router.post("/floors", upload.single("image"), async (req, res) => {
  if (!s3Client) {
    return res
      .status(500)
      .json({ error: "S3 is not configured on the server." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Image file is required." });
  }
  try {
    const safeName = (req.file.originalname || "floor.png").replace(
      /[^a-z0-9.\-_]/gi,
      "_"
    );
    const key = `floors/${Date.now()}-${safeName}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || "image/png",
        ACL: "public-read",
      })
    );
    res.json({
      key,
      url: resolvePublicUrl(key),
    });
  } catch (err) {
    console.error("Failed to upload floor image:", err);
    res
      .status(500)
      .json({ error: "Failed to upload image to storage." });
  }
});

module.exports = router;
