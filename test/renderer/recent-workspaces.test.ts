// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRecentWorkspaces, rememberWorkspace } from "../../src/renderer/lib/recent-workspaces.ts";

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

describe("recent workspaces", () => {
	it("keeps newest first, unique, and bounded", () => {
		for (const path of ["a", "b", "a", "c", "d", "e", "f", "g"]) rememberWorkspace(path);
		expect(readRecentWorkspaces()).toEqual(["g", "f", "e", "d", "c", "a"]);
	});

	it("survives malformed storage", () => {
		stored = "{not json";
		expect(readRecentWorkspaces()).toEqual([]);
	});
});
