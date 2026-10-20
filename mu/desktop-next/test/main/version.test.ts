// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import { appVersion } from "../../src/main/version.ts";

/**
 * The version a build reports. The case that matters is the one that was wrong: started as a file path, Electron
 * answers with its own version, and an updater that believes that number offers everyone the wrong answer.
 */

describe("the version", () => {
	it("reads the package the build came from", () => {
		const version = appVersion({
			buildRoot: "/work/desktop-next/out/main",
			electronVersion: "44.9.0",
			read: (path) => {
				expect(path.replaceAll("\\", "/")).toBe("/work/desktop-next/package.json");
				return JSON.stringify({ name: "mu-desktop", version: "0.1.8" });
			},
		});
		expect(version).toBe("0.1.8");
	});

	it("falls back to Electron's answer when the package is not beside the build", () => {
		expect(
			appVersion({
				buildRoot: "/Applications/mu.app/Contents/Resources/app.asar/out/main",
				electronVersion: "0.1.8",
				read: () => {
					throw new Error("ENOENT");
				},
			}),
		).toBe("0.1.8");
	});

	it("falls back when the manifest has no usable version", () => {
		expect(appVersion({ buildRoot: "/x/out/main", electronVersion: "9.9.9", read: () => JSON.stringify({ name: "x" }) })).toBe("9.9.9");
		expect(appVersion({ buildRoot: "/x/out/main", electronVersion: "9.9.9", read: () => JSON.stringify({ version: "" }) })).toBe("9.9.9");
		expect(appVersion({ buildRoot: "/x/out/main", electronVersion: "9.9.9", read: () => "not json" })).toBe("9.9.9");
	});
});
