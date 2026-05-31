import { defineConfig, devices } from "@playwright/test";

/* Sobe o servidor estatico local e roda os testes no Chromium headless.
 *
 * Em ambientes onde o Playwright nao consegue baixar o Chromium (ex.: SOs
 * muito novos), defina PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH apontando para um
 * Chrome/Chromium ja instalado. Sem essa variavel, usa o Chromium do Playwright.
 */
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const EXTRA_ARGS = process.env.PLAYWRIGHT_NO_SANDBOX ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];

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
    launchOptions: {
      executablePath: EXECUTABLE_PATH,
      args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist", ...EXTRA_ARGS],
    },
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
