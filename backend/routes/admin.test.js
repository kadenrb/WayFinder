const request = require("supertest");
const express = require("express");

// Mock auth middleware to inject an adminId and capture calls
const mockAuth = jest.fn((req, res, next) => {
  req.adminId = "admin-id";
  next();
});
jest.mock("../controllers/authController", () => (...args) => mockAuth(...args));

// Mock Prisma client so tests never hit a real database
const mockPrismaInstance = {
  admin: { findUnique: jest.fn() },
};
jest.mock("@prisma/client", () => {
  const PrismaClient = jest.fn(() => mockPrismaInstance);
  return { PrismaClient };
});

const adminRoutes = require("./admin");

const app = express();
app.use(express.json());
app.use("/admin", adminRoutes);

describe("GET /admin/me", () => {
  beforeEach(() => {
    mockAuth.mockClear();
    mockPrismaInstance.admin.findUnique.mockReset();
  });

  it("returns admin info when found", async () => {
    mockPrismaInstance.admin.findUnique.mockResolvedValue({
      email: "admin@example.com",
      tags: "demo",
    });

    const res = await request(app).get("/admin/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: "admin@example.com", tags: "demo" });
    expect(mockPrismaInstance.admin.findUnique).toHaveBeenCalledWith({
      where: { id: "admin-id" },
      select: { email: true, tags: true },
    });
  });

  it("returns 404 when admin is missing", async () => {
    mockPrismaInstance.admin.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/admin/me");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Admin not found" });
  });
});
