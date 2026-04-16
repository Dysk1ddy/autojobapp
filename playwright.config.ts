import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "src/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "npm run serve:e2e",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: true,
    timeout: 120_000
  },
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true
  }
});
