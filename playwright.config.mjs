import { defineConfig, devices } from "@playwright/test";

/* Sobe o servidor estatico local e roda os testes no Chromium headless. */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8781",
    headless: true,
    // o globo usa WebGL; em CI use o swiftshader do Chromium
    launchOptions: { args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tools/serve.mjs 8781",
    url: "http://localhost:8781/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
