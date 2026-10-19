import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

const previewURL = loadEnv("test", ".", "DEVWORLD_").DEVWORLD_TEST_URL;

// Critical journeys DW-01..DW-08 against the synthetic test provider.
// The API must run on 127.0.0.1:8000 (uvicorn devworld.api.main:app).
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: previewURL ?? "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: previewURL
    ? undefined
    : {
        command: "pnpm dev:web",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
