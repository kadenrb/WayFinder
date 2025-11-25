const express = require("express");
const { PrismaClient } = require("@prisma/client");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const router = express.Router();
const prisma = new PrismaClient();

const {
  S3_ACCESS_KEY,
  S3_SECRET_KEY,
  S3_REGION,
  S3_BUCKET,
  S3_MANIFEST_KEY,
} = process.env;

const manifestKey = S3_MANIFEST_KEY || "floors/manifest.json";
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

const streamToString = async (body) => {
  if (!body) return "";
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
};

const normalizeFloor = (floor, index = 0) => {
  const url = floor.url || floor.imageData || "";
  const toNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    id: floor.id || `floor-${index + 1}`,
    name: floor.name || `Floor ${index + 1}`,
    imageData: floor.imageData || url,
    url,
    points: Array.isArray(floor.points) ? floor.points : [],
    walkable: floor.walkable || { color: "#9F9383", tolerance: 12 },
    sortOrder: typeof floor.sortOrder === "number" ? floor.sortOrder : index,
    northOffset: toNumber(floor.northOffset),
    createdAt: floor.createdAt || new Date().toISOString(),
  };
};

const formatFloors = (records) =>
  records.map((f) => ({
    id: f.id,
    name: f.name,
    imageData: f.imageData,
    url: f.imageData,
    points: f.points || [],
    walkable: f.walkable || { color: "#9F9383", tolerance: 12 },
    sortOrder: f.sortOrder || 0,
    northOffset:
      typeof f.northOffset === "number" && Number.isFinite(f.northOffset)
        ? f.northOffset
        : 0,
    createdAt: f.createdAt,
  }));

const readManifest = async () => {
  if (!s3Client) return { floors: [] };
  try {
    const result = await s3Client.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: manifestKey,
      })
    );
    const payload = await streamToString(result.Body);
    const parsed = JSON.parse(payload || "{}");
    return {
      floors: Array.isArray(parsed?.floors) ? parsed.floors : [],
      updatedAt: parsed?.updatedAt,
    };
  } catch (err) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return { floors: [] };
    }
    throw err;
  }
};

const writeManifest = async (floors) => {
  if (!s3Client) {
    throw new Error("S3 is not configured for manifest storage.");
  }
  const body = JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      floors,
    },
    null,
    2
  );
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: manifestKey,
      Body: body,
      ContentType: "application/json",
      CacheControl: "no-cache",
    })
  );
  return floors;
};

router.get("/", async (_req, res) => {
  if (s3Client) {
    try {
      const manifest = await readManifest();
      return res.json({
        floors: manifest.floors.map((floor, index) =>
          normalizeFloor(floor, index)
        ),
      });
    } catch (err) {
      console.error("Failed to fetch published floors from S3:", err);
      return res
        .status(500)
        .json({ error: "Failed to load published floors" });
    }
  }
  try {
    const rows = await prisma.publishedFloor.findMany({
      orderBy: { sortOrder: "asc" },
    });
    res.json({ floors: formatFloors(rows) });
  } catch (err) {
    console.error("Failed to fetch published floors:", err);
    res.status(500).json({ error: "Failed to load published floors" });
  }
});

router.put("/", async (req, res) => {
  const floors = Array.isArray(req.body?.floors) ? req.body.floors : null;
  if (!floors || !floors.length) {
    return res.status(400).json({ error: "Floors array is required" });
  }
  const normalized = [];
  try {
    floors.forEach((floor, index) => {
      const normalizedFloor = normalizeFloor(floor, index);
      if (!normalizedFloor.url) {
        throw new Error("Each floor requires a URL or imageData.");
      }
      normalized.push(normalizedFloor);
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (s3Client) {
    try {
      await writeManifest(normalized);
      return res.json({ floors: normalized });
    } catch (err) {
      console.error("Failed to publish floors to S3:", err);
      return res.status(500).json({ error: "Failed to publish floors" });
    }
  }

  try {
    await prisma.$transaction([
      prisma.publishedFloor.deleteMany(),
      prisma.publishedFloor.createMany({
        data: normalized.map((floor) => ({
          name: floor.name,
          imageData: floor.imageData,
          points: floor.points,
          walkable: floor.walkable,
          sortOrder: floor.sortOrder,
          northOffset: floor.northOffset,
        })),
      }),
    ]);
    const saved = await prisma.publishedFloor.findMany({
      orderBy: { sortOrder: "asc" },
    });
    res.json({ floors: formatFloors(saved) });
  } catch (err) {
    console.error("Failed to publish floors:", err);
    res.status(500).json({ error: "Failed to publish floors" });
  }
});

router.delete("/:id", async (req, res) => {
  if (s3Client) {
    try {
      const manifest = await readManifest();
      const idToRemove = req.params.id;
      const nextFloors = manifest.floors.filter(
        (floor) => `${floor.id}` !== `${idToRemove}`
      );
      if (nextFloors.length === manifest.floors.length) {
        return res.status(404).json({ error: "Floor not found" });
      }
      await writeManifest(nextFloors);
      return res.json({ floors: nextFloors });
    } catch (err) {
      console.error("Failed to delete floor from S3 manifest:", err);
      return res.status(500).json({ error: "Failed to delete floor" });
    }
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid floor id" });
  }
  try {
    const deleted = await prisma.publishedFloor.delete({
      where: { id },
    });
    res.json({ floor: formatFloors([deleted])[0] });
  } catch (err) {
    console.error("Failed to delete floor:", err);
    res.status(500).json({ error: "Failed to delete floor" });
  }
});

module.exports = router;
