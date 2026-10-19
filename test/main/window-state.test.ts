// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { describe, expect, it } from "vitest";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH, restoreBounds } from "../../src/main/window-state.ts";

/**
 * The window comes back where it was, unless that place is no longer a place: a rectangle off every display is an app
 * that starts invisibly, which is worse than losing a position.
 */

const laptop = { x: 0, y: 0, width: 1920, height: 1080 };

describe("restored window bounds", () => {
	it("uses a saved rectangle that is still on a display", () => {
		expect(restoreBounds({ x: 120, y: 80, width: 1000, height: 700 }, [laptop])).toEqual({
			x: 120,
			y: 80,
			width: 1000,
			height: 700,
		});
	});

	it("keeps the size but drops a position no display can reach", () => {
		expect(restoreBounds({ x: 5000, y: 4000, width: 1000, height: 700 }, [laptop])).toEqual({
			width: 1000,
			height: 700,
		});
	});

	it("falls back to the default size when there is nothing usable saved", () => {
		for (const saved of [undefined, null, "wide", {}, { width: 100 }, { width: Number.NaN, height: 700 }]) {
			expect(restoreBounds(saved, [laptop])).toEqual({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
		}
	});

	it("refuses a saved rectangle smaller than the window may be", () => {
		expect(restoreBounds({ x: 10, y: 10, width: 200, height: 100 }, [laptop])).toMatchObject({
			width: MIN_WIDTH,
			height: MIN_HEIGHT,
		});
	});

	it("counts a partly visible window as visible, and a sliver as gone", () => {
		// 60 px of the window's left edge is inside the laptop's right edge.
		expect(restoreBounds({ x: 1860, y: 100, width: 900, height: 600 }, [laptop])).toMatchObject({ x: 1860 });
		// 20 px is not something a title bar can be dragged by.
		expect(restoreBounds({ x: 1900, y: 100, width: 900, height: 600 }, [laptop])).toEqual({ width: 900, height: 600 });
	});
});
