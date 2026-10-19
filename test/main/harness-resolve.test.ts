// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import {
	bundledHarnessRoot,
	envFileOf,
	expectedHarness,
	globalModuleDirs,
	launchCommand,
	launcherOf,
	nodeVersionOk,
	findHarness,
} from "../../src/main/harness.ts";

/**
 * Where the harness is found. Each source has its own test because each one is a real machine: a developer's
 * checkout beside this one, the copy a packaged app carries, a global npm install, and the environment variable
 * that overrides all of them.
 *
 * The deps are injected, so these run without Electron and without touching this machine's folders.
 */

function deps(overrides: Partial<Parameters<typeof findHarness>[1]> = {}) {
	return {
		platform: "linux" as NodeJS.Platform,
		env: {} as Record<string, string | undefined>,
		home: "/home/ada",
		exists: () => false,
		list: () => [],
		real: (file: string) => file,
		resourcesPath: undefined,
		...overrides,
	};
}

/** A deps whose only existing paths are the given ones. */
function onDisk(paths: readonly string[], overrides: Partial<Parameters<typeof findHarness>[1]> = {}) {
	const files = new Set(paths);
	return deps({ exists: (file) => files.has(file), ...overrides });
}

describe("finding the harness", () => {
	it("takes the environment variable first, even when a checkout is beside it", () => {
		const harness = findHarness(
			"/work/desktop-next",
			onDisk(["/usr/local/mu/kyrn/bin/mu.mjs", "/work/KYRN/kyrn/bin/mu.mjs"], { env: { MU_ROOT: "/usr/local/mu" } }),
		);
		expect(harness).toEqual({ root: "/usr/local/mu", layout: "repo", source: "env" });
	});

	it("reads the old KYRN_ROOT spelling too", () => {
		const harness = findHarness("/work/desktop-next", onDisk(["/opt/mu/kyrn/bin/mu.mjs"], { env: { KYRN_ROOT: "/opt/mu" } }));
		expect(harness).toMatchObject({ root: "/opt/mu", source: "env" });
	});

	it("takes the copy a packaged app carries in its resources folder", () => {
		const bundled = bundledHarnessRoot("/Applications/mu.app/Contents/Resources", "darwin");
		// The bundle is what makes it a package rather than a checkout: `layoutOf` looks for pi's bundle.
		const harness = findHarness(
			undefined,
			onDisk([`${bundled}/kyrn/bin/mu.mjs`, `${bundled}/dist/bundle/cli.js`], {
				platform: "darwin",
				resourcesPath: "/Applications/mu.app/Contents/Resources",
			}),
		);
		expect(harness).toEqual({ root: bundled, layout: "package", source: "bundled" });
	});

	it("takes the runtime a checkout staged, before a sibling checkout", () => {
		// `npm run stage:harness` writes exactly what a package carries; a clone that ran it needs no MU_ROOT and no
		// second checkout beside it.
		const staged = "/work/pi_jev_desktop/resources/harness/mu-agent";
		const harness = findHarness(
			"/work/pi_jev_desktop",
			onDisk([`${staged}/kyrn/bin/mu.mjs`, `${staged}/dist/bundle/cli.js`, "/work/KYRN/kyrn/bin/mu.mjs"]),
		);
		expect(harness).toEqual({ root: staged, layout: "package", source: "bundled" });
	});

	it("still lets MU_ROOT win over the staged copy, for work on the runtime itself", () => {
		const staged = "/work/pi_jev_desktop/resources/harness/mu-agent";
		const harness = findHarness(
			"/work/pi_jev_desktop",
			onDisk([`${staged}/kyrn/bin/mu.mjs`, "/opt/mu/kyrn/bin/mu.mjs"], { env: { MU_ROOT: "/opt/mu" } }),
		);
		expect(harness).toMatchObject({ root: "/opt/mu", source: "env" });
	});

	it("finds a checkout two repositories side by side", () => {
		const harness = findHarness("/work/desktop-next", onDisk(["/work/KYRN/kyrn/bin/mu.mjs"]));
		expect(harness).toEqual({ root: "/work/KYRN", layout: "repo", source: "beside" });
	});

	it("follows mu on PATH to the folder it belongs to", () => {
		const fileSystem = onDisk([
			"/usr/local/bin/mu",
			"/usr/local/lib/node_modules/mu-agent/kyrn/bin/mu.mjs",
			"/usr/local/lib/node_modules/mu-agent/dist/bundle/cli.js",
		]);
		const harness = findHarness(
			"/work/desktop-next",
			{ ...fileSystem, env: { PATH: "/usr/bin:/usr/local/bin" }, real: () => "/usr/local/lib/node_modules/mu-agent/kyrn/bin/mu.mjs" },
		);
		expect(harness).toMatchObject({ root: "/usr/local/lib/node_modules/mu-agent", layout: "package", source: "global" });
	});

	it("finds a global node_modules install when PATH says nothing", () => {
		const harness = findHarness(
			"/work/desktop-next",
			onDisk(["/opt/homebrew/lib/node_modules/mu-agent/kyrn/bin/mu.mjs"]),
		);
		expect(harness).toMatchObject({ root: "/opt/homebrew/lib/node_modules/mu-agent", source: "global" });
	});

	it("returns nothing when there is no harness, and says where it should have been", () => {
		expect(findHarness("/work/desktop-next", onDisk([]))).toBeUndefined();
		expect(expectedHarness("/work/desktop-next", undefined, "linux")).toEqual({ root: "/work/KYRN", layout: "repo" });
		expect(expectedHarness(undefined, "/resources", "linux")).toEqual({
			root: "/resources/harness/mu-agent",
			layout: "package",
		});
	});
});

describe("starting it", () => {
	it("uses the bash forwarder of a checkout on macOS and Linux", () => {
		expect(launcherOf({ root: "/work/KYRN", layout: "repo" }, "linux")).toBe("/work/KYRN/kyrn/bin/kyrn");
		// Windows has no bash: the Node launcher, run on the app's own binary.
		expect(launcherOf({ root: "C:\\mu", layout: "repo" }, "win32")).toBe("C:\\mu\\kyrn\\bin\\mu.mjs");
	});

	it("runs the launcher on its own binary as Node when there is no node on PATH", () => {
		const packaged = launchCommand(
			{ root: "/resources/harness/mu-agent", layout: "package" },
			{ platform: "darwin", processExecPath: "/Applications/mu.app/Contents/MacOS/mu", packaged: true },
		);
		expect(packaged.command).toBe("/Applications/mu.app/Contents/MacOS/mu");
		expect(packaged.args).toEqual(["/resources/harness/mu-agent/kyrn/bin/mu.mjs"]);
		expect(packaged.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
	});

	it("keeps the checkout's own forwarder in development", () => {
		const development = launchCommand(
			{ root: "/work/KYRN", layout: "repo" },
			{ platform: "linux", processExecPath: "/usr/bin/node", packaged: false },
		);
		expect(development).toEqual({ command: "/work/KYRN/kyrn/bin/kyrn", args: [], env: {} });
	});
});

describe("the small pieces", () => {
	it("checks a Node version against pi's minimum", () => {
		expect(nodeVersionOk("v22.19.0")).toBe(true);
		expect(nodeVersionOk("22.18.9")).toBe(false);
		expect(nodeVersionOk("v24.13.0")).toBe(true);
	});

	it("keeps the .env of a checkout in the checkout, and a package's in mu's home", () => {
		expect(envFileOf({ root: "/work/KYRN", layout: "repo" }, "/home/ada", "linux")).toBe("/work/KYRN/.env");
		expect(envFileOf({ root: "/usr/local/lib/node_modules/mu-agent", layout: "package" }, "/home/ada", "linux")).toBe(
			"/home/ada/.env",
		);
	});

	it("lists the global folders npm may have installed into, without duplicates", () => {
		const dirs = globalModuleDirs(
			deps({ env: { npm_config_prefix: "/custom" }, list: (dir) => (dir.endsWith("versions/node") ? ["v22.19.0", "v24.1.0"] : []) }),
		);
		expect(dirs).toContain("/custom/lib/node_modules");
		// npm's own configured prefix is the one folder we know npm writes to, so it comes first.
		expect(dirs[0]).toBe("/custom/lib/node_modules");
		expect(dirs).toContain("/home/ada/.npm-global/lib/node_modules");
		// Newest nvm Node first among the nvm folders.
		const nvm = dirs.filter((dir) => dir.includes(".nvm"));
		expect(nvm[0]).toContain("v24.1.0");
		expect(new Set(dirs).size).toBe(dirs.length);
	});
});
