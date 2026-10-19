// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { describe, expect, it } from "vitest";
import { applicationMenu } from "../../src/main/menu.ts";

/**
 * The menu is a platform fact, not a design choice: macOS needs one for its standard shortcuts to arrive at all, and
 * the other two platforms deliberately have none.
 */

describe("application menu", () => {
	it("gives macOS the standard roles, which is what Cmd+C and Cmd+Q travel through", () => {
		const menu = applicationMenu("darwin");
		expect(menu?.map((item) => item.role)).toEqual(["appMenu", "editMenu", "viewMenu", "windowMenu"]);
	});

	it("leaves Windows and Linux without a menu bar", () => {
		expect(applicationMenu("win32")).toBeNull();
		expect(applicationMenu("linux")).toBeNull();
	});
});
