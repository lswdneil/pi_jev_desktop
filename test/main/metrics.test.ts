// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The role parser behind the memory breakdown.
 *
 * The breakdown is what makes the idle number actionable: "336 MB" invites the wrong remedy, while "harness 130 MB,
 * Chromium 200 MB across four processes" says which change would move it. A role that is guessed wrong would put the
 * harness's memory on Chromium's side of the ledger, so the command lines it has to recognise are pinned here.
 */

import { describe, expect, it } from "vitest";

import { roleOf } from "../../scripts/collect-metrics.mjs";

const executable = "C:\\Users\\someone\\AppData\\Local\\Programs\\mu\\mu.exe";
const harness = `${executable} C:\\Users\\someone\\AppData\\Local\\Programs\\mu\\resources\\harness\\spec-ai-agent`;

describe("roleOf", () => {
	it("reads Chromium's own role from the command line", () => {
		expect(roleOf(`${executable} --type=gpu-process --user-data-dir=x`)).toBe("gpu-process");
		expect(roleOf(`${executable} --type=renderer --user-data-dir=x`)).toBe("renderer");
		expect(roleOf(`${executable} --type=utility --utility-sub-type=network.mojom.NetworkService`)).toBe("utility");
	});

	it("tells the harness from the shell it lives in", () => {
		expect(roleOf(`${executable} ${harness}\\kyrn\\bin\\agent.mjs --mode rpc`)).toBe("harness-launcher");
		expect(roleOf(`${harness}\\dist\\bundle\\cli.js -e ${harness}\\judge\\dist\\kyrn-judge.js --mode rpc`)).toBe("harness");
	});

	it("calls everything else the main process", () => {
		expect(roleOf(`"${executable}" --user-data-dir=C:\\Temp\\profile`)).toBe("main");
		expect(roleOf("")).toBe("main");
	});
});
