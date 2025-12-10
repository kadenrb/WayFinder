// import express to create API routes 
const express = require("express");
// multer is used for paring multipart/form-data (file uploads)
const multer = require("multer");
// import AWS S3 client and commands from AWS SDK v3
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
// create an express router instance
const router = express.Router();
// configure multer to store uploaded files in memory (RAM) ( size limit 25mb)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
// load S3 configuration from environment variables 
const {
  S3_ACCESS_KEY,
  S3_SECRET_KEY,
  S3_REGION,
  S3_BUCKET,
  S3_PUBLIC_BASE_URL,
} = process.env;
// check if all S3 credentials / configuration are present 
const hasS3Config =
  S3_ACCESS_KEY && S3_SECRET_KEY && S3_REGION && S3_BUCKET;

// initialize S3 client if configuration exists 
const s3Client = hasS3Config
  ? new S3Client({
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
    })
  : null;


// helper function to resolve the public URL of an S3 object
// if S3_PUBLIC_BASE_URL is set, use it as the base URL, 
// otherwise use the default S3 URL format
const resolvePublicUrl = (key) => {
  if (S3_PUBLIC_BASE_URL) {
    return `${S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
};
// post floors 
// endpoints to upload a single floor image to S3 
router.post("/floors", upload.single("image"), async (req, res) => {
  // ensure S3 is configured 
  if (!s3Client) {
    return res
      .status(500)
      .json({ error: "S3 is not configured on the server." });
  }
  // ensure a file was provided 
  if (!req.file) {
    return res.status(400).json({ error: "Image file is required." });
  }
  try {
    // sanitize filename and prepend timestamp to create unqiue S3 key
    const safeName = (req.file.originalname || "floor.png").replace(
      /[^a-z0-9.\-_]/gi,
      "_"
    );
    const key = `floors/${Date.now()}-${safeName}`;
    // upload the file to S3 
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || "image/png",
      })
    );
    // return the S3 key and public URL 
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


// put floor manifest
// endpoint to upload or update the floors manifest JSON file in S3
// expects the manifest content in the request body 
router.put("/floors/manifest", async (req, res) => {
  if (!s3Client) {
    return res
      .status(500)
      .json({ error: "S3 is not configured on the server." });
  }
  try {
    const manifestKey = "floors/manifest.json";
    // upload the manifest JSON to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: manifestKey,
        Body: Buffer.from(JSON.stringify(req.body || {})),
        ContentType: "application/json",
      })
    );
    // return the manifest key and public URL
    res.json({
      key: manifestKey,
      url: resolvePublicUrl(manifestKey),
    });
  } catch (err) {
    console.error("Failed to upload floor manifest:", err);
    res
      .status(500)
      .json({ error: "Failed to upload manifest to storage." });
  }
});
// export the router so it can be used in main server
module.exports = router;
