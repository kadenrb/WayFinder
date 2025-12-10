// import test utilites from supertest and sumulate http requests
const request = require("supertest");
// import express to mount and test the route handler 
const express = require("express");

/* 
 * -- Mock authentication middleware -- 
 * create a jest mock function that acts as fake auth middleware
 * it injects a fixed adminID and immdeiately calls next()
*/
const mockAuth = jest.fn((req, res, next) => {
  req.adminId = "admin-id";
  next();
});
/* 
 * replace the real authcontroller with our mock middleware
 * any time the route requires authcontroller, jest provides mock auth instead
*/ 
jest.mock("../controllers/authController", () => (...args) => mockAuth(...args));

// create a mock prisma client instance with only the methods we need
const mockPrismaInstance = {
  admin: { findUnique: jest.fn() }, // mock database call
};
// overrider the prismaclient so it returns our mock instacne 
jest.mock("@prisma/client", () => {
  const PrismaClient = jest.fn(() => mockPrismaInstance);
  return { PrismaClient };
});

/*
 * load routes and initalize test application
 * import the adin routes after mock are applied 
*/
const adminRoutes = require("./admin");

// create a minimal express app for testing 
const app = express();
app.use(express.json());
// mount the admin routes at /admin path
app.use("/admin", adminRoutes);

// test suite for GET /admin/me route
describe("GET /admin/me", () => {
  //reset mocks before each test
  beforeEach(() => {
    mockAuth.mockClear();
    mockPrismaInstance.admin.findUnique.mockReset();
  });
  // seccess case test
  it("returns admin info when found", async () => {
    // configure mock DB to reutnr valid admin data 
    mockPrismaInstance.admin.findUnique.mockResolvedValue({
      email: "admin@example.com",
      tags: "demo",
    });
    // issue get request through supertest 
    const res = await request(app).get("/admin/me");

    // validate http response 
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: "admin@example.com", tags: "demo" });
    // ensure prisma was called with correct query parameters
    expect(mockPrismaInstance.admin.findUnique).toHaveBeenCalledWith({
      where: { id: "admin-id" },
      select: { email: true, tags: true },
    });
  });
  // admin not found case test 
  it("returns 404 when admin is missing", async () => {
    // simulate db returning no matching admin
    mockPrismaInstance.admin.findUnique.mockResolvedValue(null);
    // issue request
    const res = await request(app).get("/admin/me");
    // validate response 
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Admin not found" });
  });
});
