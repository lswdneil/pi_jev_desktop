// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * Three builds, one output folder each: the main process, the preload, and the page.
 *
 * The page's HTML entry lives in `src/renderer/index.html` and is what Vite builds; the main process then serves
 * that build over `app://mu` (see `src/main/app-protocol.ts`), which is why the renderer's output folder is resolved
 * from here rather than guessed at runtime.
 */
export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "out/main",
			minify: "oxc",
			rollupOptions: { input: resolve(__dirname, "src/main/index.ts") },
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "out/preload",
			rollupOptions: { input: resolve(__dirname, "src/preload/main.ts") },
		},
	},
	renderer: {
		root: resolve(__dirname, "src/renderer"),
		plugins: [react()],
		build: {
			outDir: resolve(__dirname, "out/renderer"),
			emptyOutDir: true,
			minify: "oxc",
			cssMinify: "lightningcss",
			// No inline module-preload polyfill: the policy allows scripts from this origin, not inline ones.
			modulePreload: { polyfill: false },
		},
	},
});
