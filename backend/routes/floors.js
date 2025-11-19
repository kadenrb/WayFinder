const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

const formatFloors = (records) =>
  records.map((f) => ({
    id: f.id,
    name: f.name,
    imageData: f.imageData,
    url: f.imageData,
    points: f.points || [],
    walkable: f.walkable || { color: "#9F9383", tolerance: 12 },
    sortOrder: f.sortOrder || 0,
    createdAt: f.createdAt,
  }));

router.get("/", async (_req, res) => {
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

router.put("/publish", async (req, res) => {
  try {
    const floors = Array.isArray(req.body?.floors) ? req.body.floors : null;
    if (!floors || !floors.length) {
      return res.status(400).json({ error: "Floors array is required" });
    }
    for (const floor of floors) {
      if (!floor?.imageData) {
        return res.status(400).json({ error: "Each floor requires imageData" });
      }
    }
    await prisma.$transaction([
      prisma.publishedFloor.deleteMany(),
      prisma.publishedFloor.createMany({
        data: floors.map((floor, index) => ({
          name: floor.name || `Floor ${index + 1}`,
          imageData: floor.imageData,
          points: floor.points || [],
          walkable: floor.walkable || { color: "#9F9383", tolerance: 12 },
          sortOrder:
            typeof floor.sortOrder === "number" ? floor.sortOrder : index,
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
