import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import LandingPage from "../LandingPage";

// Mock child components that are outside test scope
jest.mock("../MapEditor", () => () => <div data-testid="map-editor" />);

// Spy on navigate so we can assert redirects without a real router
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const API_URL = "https://wayfinder-lgw7.onrender.com";
const MANIFEST_URL =
  "https://wayfinder-floors.s3.us-east-2.amazonaws.com/floors/manifest.json";

describe("LandingPage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    localStorage.clear();
    process.env.REACT_APP_API_URL = API_URL;
    process.env.REACT_APP_MANIFEST_URL = MANIFEST_URL;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders admin welcome when fetch succeeds", async () => {
    localStorage.setItem("token", "test-token");

    const adminResponse = { email: "admin@example.com", tags: "demo" };
    global.fetch = jest.fn((url) => {
      if (`${API_URL}/admin/me` === url) {
        return Promise.resolve({
          ok: true,
          json: async () => adminResponse,
        });
      }
      if (url === MANIFEST_URL) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ floors: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Welcome,/i)).toBeInTheDocument();
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("redirects to home when admin fetch fails", async () => {
    localStorage.setItem("token", "test-token");

    global.fetch = jest.fn((url) => {
      if (`${API_URL}/admin/me` === url) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "fail" }),
        });
      }
      if (url === MANIFEST_URL) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ floors: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });
});
