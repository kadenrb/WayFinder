import React from "react"; // import react to use JSX 
import { MemoryRouter } from "react-router-dom"; // import memory router for routing context in tests
import { render, screen, waitFor } from "@testing-library/react"; // import testing library functions 
import LandingPage from "../LandingPage"; // component under test

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
  // Test suite for LandingPage component
describe("LandingPage", () => {
  // runs before each test in this suite
  beforeEach(() => {
    mockNavigate.mockReset();  // Reset navigation mock between tests
    localStorage.clear();    // Clear localStorage to avoid test interference 
    // Set required environment variables for the component
    process.env.REACT_APP_API_URL = API_URL;
    process.env.REACT_APP_MANIFEST_URL = MANIFEST_URL;
  });
  // runs after each test in this suite
  afterEach(() => {
    jest.restoreAllMocks(); // Restore original implementations of mocked functions
  });
  // Test case: successful fetch of admin data
  it("renders admin welcome when fetch succeeds", async () => {
    localStorage.setItem("token", "test-token"); // sumulate authenticated admin session 
    // Mock fetch to return successful admin data
    const adminResponse = { email: "admin@example.com", tags: "demo" };
    global.fetch = jest.fn((url) => { // Mock global fetch for all network requests used by LandingPage
      if (`${API_URL}/admin/me` === url) { // admin profile reuqest 
        return Promise.resolve({
          ok: true,
          json: async () => adminResponse,
        });
      } // floor manifest request
      if (url === MANIFEST_URL) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ floors: [] }),
        });
      } // fail test if an expected request is made
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    // Render LandingPage inside MemoryRouter
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );
    // Assert that admin welcome message is displayed
    expect(await screen.findByText(/Welcome,/i)).toBeInTheDocument();
    // Assert that admin email is rendered
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
    // Assert that no redirection occurred
    expect(mockNavigate).not.toHaveBeenCalled();
  });
  // Test case: failed fetch of admin data
  it("redirects to home when admin fetch fails", async () => {
    localStorage.setItem("token", "test-token"); // Simulate an authenticated admin session

    global.fetch = jest.fn((url) => { // mocked failed admin profile response
      if (`${API_URL}/admin/me` === url) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "fail" }),
        });
      } // floor manifest request
      if (url === MANIFEST_URL) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ floors: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    // Render LandingPage inside MemoryRouter
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );
    // wait for navigation to be triggered
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });
});
