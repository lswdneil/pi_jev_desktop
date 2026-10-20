// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { defineConfig } from "vitest/config";

/**
 * The main-process and renderer-store tests. No Electron: dependencies and browser scheduling are injected or stubbed.
 * Renderer components, isolation and policy are exercised in `test/e2e`, and the
 * `.mts` extension keeps the file unambiguously ESM without making the whole package `"type": "module"` — the
 * preload must stay CommonJS because it is sandboxed.
 */
export default defineConfig({
	test: {
		include: ["test/main/**/*.test.ts", "test/renderer/**/*.test.ts"],
		environment: "node",
	},
});
