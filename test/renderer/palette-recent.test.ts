// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRecentPalette, rememberPaletteUse } from "../../src/renderer/lib/palette-recent.ts";

let stored = "";

beforeEach(() => {
	stored = "";
	vi.stubGlobal("window", {
		localStorage: {
			getItem: () => stored || null,
			setItem: (_key: string, value: string) => {
				stored = value;
			},
		},
	});
});

afterEach(() => vi.unstubAllGlobals());

describe("recent palette entries", () => {
	it("keeps the newest first, unique, and bounded", () => {
		for (const id of ["a", "b", "a", "c", "d", "e", "f", "g"]) rememberPaletteUse(id);
		expect(readRecentPalette()).toEqual(["g", "f", "e", "d", "c", "a"]);
	});

	it("survives malformed storage", () => {
		stored = "not json";
		expect(readRecentPalette()).toEqual([]);
	});
});
