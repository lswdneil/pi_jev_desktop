// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPanelsOpen, rememberPanelsOpen } from "../../src/renderer/lib/panel-visibility.ts";

let stored: string | null = null;

beforeEach(() => {
	stored = null;
	vi.stubGlobal("window", {
		localStorage: {
			getItem: () => stored,
			setItem: (_key: string, value: string) => {
				stored = value;
			},
		},
	});
});

afterEach(() => vi.unstubAllGlobals());

describe("panel visibility", () => {
	it("opens the panels until someone folds them", () => {
		expect(readPanelsOpen()).toBe(true);
		rememberPanelsOpen(false);
		expect(readPanelsOpen()).toBe(false);
		rememberPanelsOpen(true);
		expect(readPanelsOpen()).toBe(true);
	});

	it("falls back to open when storage is unavailable", () => {
		vi.stubGlobal("window", {
			get localStorage(): Storage {
				throw new Error("storage disabled");
			},
		});
		expect(readPanelsOpen()).toBe(true);
		expect(() => rememberPanelsOpen(false)).not.toThrow();
	});
});
