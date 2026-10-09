const { defineConfig, devices } = require('@playwright/test');

const PORTA = 3100;

module.exports = defineConfig({
  testDir: './tests/e2e',
  // O servidor guarda os dados em memória e é compartilhado: execução em série
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORTA}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: `http://localhost:${PORTA}/api/produtos`,
    env: { PORT: String(PORTA) },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
