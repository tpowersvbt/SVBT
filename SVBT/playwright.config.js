import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './tests/ui',
  globalSetup: './tests/ui/global-setup.js',
  workers: 1,
  use: { baseURL: 'http://localhost:3005', headless: true, browserName: 'chromium', channel: 'msedge' },
  webServer: { command: 'node server/index.js --dev', cwd: appRoot, url: 'http://localhost:3005/api/health', reuseExistingServer: false, env: { NODE_ENV: 'test', PORT: '3005', APP_ORIGIN: 'http://localhost:3005', DB_PATH: resolve(appRoot, '.tools/ui-test.sqlite'), STATEMENT_DIR: resolve(appRoot, '.tools/ui-statements') }, timeout: 120000 }
});
