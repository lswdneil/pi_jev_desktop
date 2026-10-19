// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { defineConfig } from "@playwright/test";

/**
 * The end-to-end tests drive the built app: `npm run build` first, then `npm run test:e2e`.
 *
 * They are serial on purpose. Each one starts a real Electron app with its own agent process, and a test that
 * asserts "no CSP violations" is worthless if another test's window is a variable.
 */
export default defineConfig({
	testDir: "test/e2e",
	fullyParallel: false,
	workers: 1,
	forbidOnly: true,
	timeout: 120_000,
	expect: { timeout: 30_000 },
	reporter: [["list"]],
	use: { trace: "retain-on-failure" },
});
