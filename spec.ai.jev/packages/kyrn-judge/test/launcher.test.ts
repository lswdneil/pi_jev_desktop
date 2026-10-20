import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BIN, SPEC, removeHome, runPowerShell, runScript, searchPath, WINDOWS_POWERSHELL } from "./fixtures/launcher.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Starting pi needs the repository's dependencies; a bare git worktree has none. */
const installed = existsSync(join(root, "node_modules/.bin/tsx"));
const windows = process.platform === "win32";

const homes: string[] = [];
function home(): string {
	const dir = mkdtempSync(join(tmpdir(), "spec-launcher-"));
	homes.push(dir);
	return dir;
}
afterEach(() => {
	while (homes.length > 0) removeHome(homes.pop() as string);
});

/** `spec` as this platform runs it (spec.cmd on Windows), or another script of kyrn/bin; what it wrote, in one. */
function run(command: string, args: string[], env: Record<string, string>, timeout?: number) {
	const result = runScript(command === "spec" ? SPEC : join(BIN, command), args, env, timeout);
	return { code: result.code, out: `${result.out}${result.err}` };
}

describe("the spec launcher", () => {
	it("links itself as `spec`, and leaves another program of that name alone", () => {
		const dir = home();
		const links = join(dir, "bin");
		// A link on POSIX; on Windows, where a link to a script cannot be run, a small spec.cmd.
		const linked = join(links, windows ? "spec.cmd" : "spec");
		const other = join(dir, "other");
		mkdirSync(other);
		if (windows) writeFileSync(join(other, "spec.bat"), "@echo maildir-utils\r\n");
		else {
			writeFileSync(join(other, "spec"), "#!/bin/sh\necho maildir-utils\n");
			chmodSync(join(other, "spec"), 0o755);
		}

		const shadowing = run("spec", ["link"], { HOME: dir, SPEC_AI_JEV_LINK_DIR: links, PATH: searchPath(other) });
		expect(shadowing.code).toBe(1);
		expect(shadowing.out).toContain("Another spec is already on your PATH");
		expect(existsSync(linked)).toBe(false);

		expect(run("spec", ["link"], { HOME: dir, SPEC_AI_JEV_LINK_DIR: links }).code).toBe(0);
		if (windows) expect(readFileSync(linked, "utf8")).toContain("spec-link-shim");
		else expect(readlinkSync(linked)).toBe(join(BIN, "spec"));
		// Linking again over its own link is fine; a file that is not a link to it is not replaced.
		expect(run("spec", ["link"], { HOME: dir, SPEC_AI_JEV_LINK_DIR: links, PATH: searchPath(links) }).code).toBe(0);
		rmSync(linked);
		writeFileSync(linked, "someone else's file");
		expect(run("spec", ["link"], { HOME: dir, SPEC_AI_JEV_LINK_DIR: links }).code).toBe(1);
		expect(readFileSync(linked, "utf8")).toBe("someone else's file");
	});

	// spec.ps1 is there so that a prompt reaches spec exactly, which cmd cannot promise. `spec import` repeats an option it
	// does not know word for word, so what it says is what node was given.
	it.runIf(windows)(
		"hands every argument to spec exactly from PowerShell: quotes, &, %, spaces and backslashes",
		() => {
			const dir = home();
			const pwsh = (process.env.PATH ?? "")
				.split(delimiter)
				.map((folder) => join(folder, "pwsh.exe"))
				.find((file) => existsSync(file));
			const runs = [
				{ shell: WINDOWS_POWERSHELL, legacy: false },
				...(pwsh
					? [
							{ shell: pwsh, legacy: false },
							{ shell: pwsh, legacy: true },
						]
					: []),
			];
			for (const { shell, legacy } of runs) {
				for (const option of ['--say "hi" & 100% done', "--dir=C:\\my dir\\", '--quote=a\\"b']) {
					const result = runPowerShell(shell, ["import", option], { HOME: dir }, { legacy });
					const output = `${result.out}${result.err}`;
					const said = output.split(/\r?\n/).find((line) => line.includes("unknown option "));
					const where = `${shell}${legacy ? " (legacy arguments)" : ""}\n${output}`;
					expect(said?.slice(said.indexOf("unknown option ") + "unknown option ".length), where).toBe(option);
					expect(result.code, where).toBe(2);
				}
			}
		},
		180_000,
	);

	// These start pi, through tsx: on GitHub's Windows runners that takes over ten seconds.
	it.skipIf(!installed)(
		"rebuilds an app view that still carries the old name, keeping pi's package name",
		() => {
			const dir = home();
			const app = join(dir, ".spec.ai.jev/app");
			mkdirSync(app, { recursive: true });
			const stale = { name: "@earendil-works/pi-coding-agent", piConfig: { name: "old-app", configDir: ".old" } };
			writeFileSync(join(app, "package.json"), JSON.stringify(stale));
			// Newer than upstream's package.json, so the age check alone would keep it.
			utimesSync(join(app, "package.json"), new Date("2030-01-01"), new Date("2030-01-01"));

			const version = run("spec", ["--version"], { HOME: dir });

			expect(version.code).toBe(0);
			const rebuilt = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
			expect(rebuilt.piConfig).toEqual({ name: "spec", configDir: ".spec.ai.jev" });
			expect(rebuilt.name).toBe("@earendil-works/pi-coding-agent");
			expect(existsSync(join(dir, ".spec.ai.jev/agent"))).toBe(true);
		},
		60_000,
	);

	it.skipIf(!installed)(
		"runs pi's own commands instead of prompting pi with them",
		() => {
			const dir = home();

			const list = run("spec", ["list"], { HOME: dir });
			expect(list.code).toBe(0);
			expect(list.out).toContain("No packages installed.");

			// A package command missing its source says so; it does not hand the word to the model as a prompt.
			const install = run("spec", ["install"], { HOME: dir });
			expect(install.code).not.toBe(0);
			expect(install.out).toContain("Missing install source.");
		},
		60_000,
	);
});
