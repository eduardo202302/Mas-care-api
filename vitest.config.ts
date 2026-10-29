import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Test-only secrets for the WhatsApp webhook and token encryption; never real credentials.
    env: { WA_APP_SECRET: 'test-app-secret', WA_VERIFY_TOKEN: 'test-verify-token', CREDENTIALS_ENCRYPTION_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=' },
    exclude: ['dist/**', 'node_modules/**'],
    maxWorkers: 1,
    // Remote databases (Neon) need more than 5 s per call: a login alone takes about 0.5 s.
    testTimeout: process.env.RUN_DB_TESTS === '1' ? 120_000 : 5_000,
    hookTimeout: process.env.RUN_DB_TESTS === '1' ? 120_000 : 10_000,
  },
});
