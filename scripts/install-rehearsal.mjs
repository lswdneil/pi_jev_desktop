// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The installer, run the way a user runs it — and used the way a user uses it.
 *
 * `smoke-package.mjs` proves that the packaged folder starts; it says nothing about the result of running the `.exe`
 * that a release publishes. This does: silent install into a directory of its own, start the installed app with a home
 * and a profile of its own, walk the first run, require the agent to report `running · package`, ask a question and
 * require an answer that came through a local provider stub, require the shell log to land in that temporary home,
 * require the real profile to be untouched, then uninstall and require the directory to be gone.
 *
 * With `--next`, it also upgrades: the second installer goes over the first in the same directory, the app is started
 * again with the same profile and home, and what must hold is that the wizard does not come back, the new version is
 * on screen, and the session file the real turn wrote is byte for byte the same afterwards.
 *
 * It is a rehearsal, not a CI step: it needs a display, an installer, and Windows. The release runbook runs it once per
 * artifact, because the installer bytes are not reproducible — the bytes that get signed are the bytes someone
 * installed here.
 *
 *   node scripts/install-rehearsal.mjs [path to the installer] [--next path to a newer installer]
 */

import { _electron } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROMPT = "hello from the install rehearsal";
const ANSWER = "Hello from the stub.";
const STUB_MODEL = "stub/stub-1";

const argv = process.argv.slice(2);
const nextFlag = argv.indexOf("--next");
const nextInstaller = nextFlag === -1 ? undefined : argv[nextFlag + 1];
if (nextFlag !== -1 && nextInstaller === undefined) throw new Error("--next needs the path of the newer installer");
/** The installer shares its app id with a real install, so this machine needs the flag before it gets overwritten. */
const allowExisting = argv.includes("--allow-existing-install");
const installer = argv.find((value) => !value.startsWith("--") && value !== nextInstaller) ?? findInstaller();
const realHome = process.env.USERPROFILE ?? process.env.HOME ?? "";

/** The one installer `dist/` holds. Two of them means the caller has to say which, not that this guesses. */
function findInstaller() {
	const directory = "dist";
	if (!existsSync(directory)) throw new Error("no dist: run `npm run package -- --win --x64` first");
	const candidates = readdirSync(directory).filter((name) => /^spec\.ai\.jev-.*-x64\.exe$/.test(name));
	if (candidates.length === 1) return join(directory, candidates[0]);
	if (candidates.length === 0) throw new Error("no installer in dist: run `npm run package -- --win --x64` first");
	throw new Error(`dist holds ${candidates.join(", ")}; pass the one to rehearse as an argument`);
}

/**
 * An OpenAI-compatible endpoint that answers without a key, in this process.
 *
 * The rehearsal is about spec.ai.jev, not about a provider: what has to hold is that the installed app carries the question to
 * the harness, the harness to a provider, and the answer back to the window and to a session file. A local stub makes
 * that testable with no network and no secret.
 */
function startStubProvider(outsidePath) {
	const requests = [];
	let streamed = false;
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			requests.push(`${request.method} ${request.url}`);
			if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
				response.writeHead(404, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: "not found" } }));
				return;
			}
			streamed = true;
			const chunk = (delta, finish) =>
				`data: ${JSON.stringify({
					id: "stub-1",
					object: "chat.completion.chunk",
					created: 1,
					model: "stub-1",
					choices: [{ index: 0, delta, finish_reason: finish }],
				})}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			if (requests.length === 2) {
				// The second prompt asks for a write outside the project: the kernel's guard has to ask the person.
				response.write(
					chunk(
						{
							role: "assistant",
							tool_calls: [
								{
									index: 0,
									id: "call-write",
									type: "function",
									function: { name: "write", arguments: JSON.stringify({ path: outsidePath, content: "should not exist" }) },
								},
							],
						},
						null,
					),
				);
				response.write(chunk({}, "tool_calls"));
			} else if (requests.length >= 3) {
				response.write(chunk({ role: "assistant", content: "Understood, I did not write it." }, null));
				response.write(chunk({}, "stop"));
			} else {
				response.write(chunk({ role: "assistant", content: "Hello " }, null));
				response.write(chunk({ content: "from the stub." }, null));
				response.write(chunk({}, "stop"));
			}
			response.write("data: [DONE]\n\n");
			response.end();
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") throw new Error("the stub provider has no port");
			resolve({ port: address.port, requests, streamed: () => streamed, close: () => server.close() });
		});
	});
}

/** The first run, clicked through by its own words: a profile that has never answered it starts here. */
const FIRST_RUN = [
	["language", (page) => page.getByText("Settings · en").click()],
	["continue", (page) => page.getByRole("button", { name: /Continue/ }).click()],
	["consent", (page) => page.getByRole("button", { name: "Not now" }).click()],
	[
		"model",
		async (page) => {
			const choice = page.locator(`[data-testid="first-run-model"] input[value="${STUB_MODEL}"]`);
			await choice.waitFor({ state: "attached", timeout: 90_000 });
			await choice.click();
			await page.locator('[data-testid="first-run-finish"]').click();
		},
	],
];

function countFiles(directory) {
	let files = 0;
	let bytes = 0;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			const nested = countFiles(path);
			files += nested.files;
			bytes += nested.bytes;
		} else {
			files += 1;
			bytes += statSync(path).size;
		}
	}
	return { files, bytes };
}

/** The version Explorer shows; the app's own `v0.1.8` comes from the asar, this one from the executable's resource. */
function fileVersion(path) {
	const result = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Item '${path}').VersionInfo.FileVersion`], {
		encoding: "utf8",
	});
	return result.stdout.trim();
}

/**
 * What the real profile looks like from the outside: how many entries the agent folder has, the newest file in it, and
 * how many workspaces the session folder knows. A rehearsal that writes any of them changed this fingerprint.
 */
function agentFingerprint(home) {
	const directory = join(home, ".spec.ai.jev", "agent");
	if (!existsSync(directory)) return { entries: 0, newest: 0, sessions: 0 };
	const entries = readdirSync(directory, { withFileTypes: true });
	let newest = 0;
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isFile()) newest = Math.max(newest, statSync(path).mtimeMs);
	}
	const sessions = join(directory, "sessions");
	return { entries: entries.length, newest, sessions: existsSync(sessions) ? readdirSync(sessions).length : 0 };
}

/** Every session file under the temporary home, with its text: the turn has to be in one of them. */
function sessionFiles(home) {
	const root = join(home, ".spec.ai.jev", "agent", "sessions");
	const found = [];
	if (!existsSync(root)) return found;
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".jsonl")) found.push({ path, text: readFileSync(path, "utf8") });
		}
	};
	walk(root);
	return found;
}

/**
 * The spec.ai.jev entries a previous install left outside its own folder, with what they point at: the uninstall entry's
 * `UninstallString` and the Start Menu shortcut's target. A rehearsal that only checks the folder would pass on an
 * uninstaller that forgets both.
 */
let specStateCalls = 0;

/** PowerShell from a temp file: a multi-line script through -Command can wait on stdin forever, which is a hang. */
function runPowerShell(script) {
	const file = join(tmpdir(), `spec-state-${process.pid}-${specStateCalls++}.ps1`);
	writeFileSync(file, script, "utf8");
	try {
		const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { encoding: "utf8", timeout: 120_000 });
		return result.stdout ?? "";
	} finally {
		rmSync(file, { force: true });
	}
}

function specState() {
	const script = [
		"$rows = @()",
		"Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object {",
		"  $item = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue",
		"  if ($item.DisplayName -eq 'spec.ai.jev') { $rows += ('registry|' + $_.PSPath + '|' + $item.UninstallString) }",
		"}",
		"$programs = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'",
		"if (Test-Path $programs) {",
		"  $shell = New-Object -ComObject WScript.Shell",
		"  Get-ChildItem $programs -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -eq 'spec.ai.jev' } | ForEach-Object {",
		"    $target = ''",
		"    try { $target = $shell.CreateShortcut($_.FullName).TargetPath } catch { }",
		"    $rows += ('shortcut|' + $_.FullName + '|' + $target)",
		"  }",
		"}",
		"$rows",
	].join("\n");
	return runPowerShell(script)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("registry|") || line.startsWith("shortcut|"))
		.map((line) => {
			const [kind, path, target] = line.split("|");
			return { kind, path, target: target ?? "" };
		});
}

/** Machine-wide entries: a per-user install must not add any, so `HKLM` is checked for the rehearsal's own path. */
function machineState() {
	const script = [
		"$rows = @()",
		"Get-ChildItem 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object {",
		"  $item = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue",
		"  if ($item.DisplayName -eq 'spec.ai.jev') { $rows += ($_.PSPath + '|' + $item.UninstallString) }",
		"}",
		"$rows",
	].join("\n");
	return runPowerShell(script)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("Microsoft.PowerShell.Core\\Registry::") || line.startsWith("HKEY_LOCAL_MACHINE"));
}

/**
 * A machine that already has spec installed shares the installer's app id, so a rehearsal would overwrite that install's
 * Start Menu entry and uninstall key. Both are copied first and put back afterwards; the caller still has to say yes.
 */
function snapshotState(directory) {
	mkdirSync(directory, { recursive: true });
	const state = specState();
	const registry = [];
	const shortcuts = [];
	for (const [index, entry] of state.entries()) {
		if (entry.kind === "registry") {
			const file = join(directory, `uninstall-${index}.reg`);
			const key = entry.path.replace("Microsoft.PowerShell.Core\\Registry\\", "").replace("HKEY_CURRENT_USER", "HKCU");
			if (spawnSync("reg", ["export", key, file, "/y"], { encoding: "utf8" }).status === 0) registry.push(file);
		} else {
			const file = join(directory, `shortcut-${index}.lnk`);
			copyFileSync(entry.path, file);
			shortcuts.push({ path: entry.path, file });
		}
	}
	return { registry, shortcuts, state };
}

function restoreState(snapshot) {
	for (const file of snapshot.registry) spawnSync("reg", ["import", file], { stdio: "ignore" });
	for (const link of snapshot.shortcuts) copyFileSync(link.file, link.path);
}

/** A run that inherits the developer's keys would not be the no-key first run this rehearsal means to test. */
function isolatedEnvironment(home) {
	const env = { ...process.env, HOME: home, USERPROFILE: home };
	for (const key of Object.keys(env)) {
		if (/^(SPEC_AI_JEV_|OPENROUTER_|AI_GATEWAY_|ANTHROPIC_|OPENAI_)/.test(key)) delete env[key];
	}
	return env;
}

async function readRunningAgent(page) {
	const deadline = Date.now() + 90_000;
	let text = "";
	while (Date.now() < deadline) {
		text = (await page.textContent("body")) ?? "";
		if (/running · package/.test(text)) return text;
		if (/could not start|exited with code|was not found/i.test(text)) {
			throw new Error(`the installed app started, but not its harness:\n${text.slice(0, 800)}`);
		}
		await page.waitForTimeout(1000);
	}
	throw new Error(`the installed app never reached a running agent:\n${text.slice(0, 800)}`);
}

function installInto(installerPath, directory) {
	const result = spawnSync(installerPath, ["/S", `/D=${directory}`], { stdio: "inherit", timeout: 300_000 });
	if (result.status !== 0) throw new Error(`the silent install of ${installerPath} exited ${result.status}`);
}

async function openInstalled(executable, profileDir, home) {
	const app = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profileDir}`], env: isolatedEnvironment(home) });
	const page = await app.firstWindow();
	await page.waitForLoadState("domcontentloaded");
	return { app, page };
}

async function main() {
	if (!existsSync(installer)) throw new Error(`no installer at ${installer}`);
	if (nextInstaller !== undefined && !existsSync(nextInstaller)) throw new Error(`no installer at ${nextInstaller}`);
	if (!existsSync(join(realHome, ".spec.ai.jev"))) console.log("install rehearsal: this machine has no ~/.spec.ai.jev to protect; the isolation check is vacuous");

	// A path outside the project the stub will ask to write: the guard has to ask, and the denial must keep it absent.
	const deniedWrite = join(tmpdir(), "spec-rehearsal-write-denied.txt");
	rmSync(deniedWrite, { force: true });
	const stub = await startStubProvider(deniedWrite);
	const root = mkdtempSync(join(tmpdir(), "spec-install-rehearsal-"));
	const installDir = join(root, "app");
	const home = join(root, "home");
	const profile = join(root, "profile");
	mkdirSync(join(home, ".spec.ai.jev", "agent"), { recursive: true });
	writeFileSync(
		join(home, ".spec.ai.jev", "agent", "models.json"),
		`${JSON.stringify({
			providers: {
				stub: { baseUrl: `http://127.0.0.1:${stub.port}/v1`, api: "openai-completions", apiKey: "stub", models: [{ id: "stub-1", name: "stub-1" }] },
			},
		})}\n`,
		"utf8",
	);
	const evidence = { installer: statSync(installer).size, agentBefore: agentFingerprint(realHome) };
	const realLog = join(realHome, ".spec.ai.jev", "agent", "logs", "spec-shell.log");
	const realLogBefore = existsSync(realLog) ? statSync(realLog).mtimeMs : 0;
	/** Filled in once the machine's existing spec.ai.jev entries are snapshotted; `finally` puts them back. */
	let snapshot;

	try {
		snapshot = snapshotState(join(root, "state"));
		const existing = snapshot.state.filter((entry) => !entry.target.includes("spec-install-rehearsal-"));
		if (existing.length > 0 && !allowExisting) {
			throw new Error(
				`this machine already has spec installed (${existing.map((entry) => entry.target || entry.path).join(", ")}); the installer shares its app id and would overwrite that install's Start Menu entry and uninstall key. Pass --allow-existing-install to rehearse anyway (they are snapshotted and put back).`,
			);
		}
		if (existing.length > 0) console.log(`install rehearsal: ${existing.length} existing spec.ai.jev entr(y/ies) snapshotted and will be put back`);
		evidence.existing = existing.length;

		installInto(installer, installDir);
		const executable = join(installDir, "spec.ai.jev.exe");
		if (!existsSync(executable)) throw new Error(`the installer produced no ${executable}`);
		evidence.installed = countFiles(installDir);
		evidence.fileVersion = fileVersion(executable);
		const ours = specState().filter((entry) => entry.target.includes(installDir));
		evidence.registered = ours.length;
		if (ours.length === 0) throw new Error("the installer registered no uninstall entry or Start Menu shortcut for this install");
		// Per-user install: nothing about this install may appear in HKLM.
		if (machineState().some((line) => line.includes(installDir))) {
			throw new Error("the installer wrote a machine-wide uninstall entry; this install is meant to be per-user");
		}
		console.log(
			`install rehearsal: installed ${evidence.installed.files} files, ${(evidence.installed.bytes / 1024 / 1024).toFixed(0)} MB, FileVersion ${evidence.fileVersion}`,
		);

		const first = await openInstalled(executable, profile, home);
		try {
			if ((await first.page.locator('[data-testid="first-run"]').count()) === 0) throw new Error("a fresh profile did not show the first-run wizard");
			for (const [label, click] of FIRST_RUN) {
				try {
					await click(first.page);
					await first.page.waitForTimeout(1500);
				} catch {
					console.log(`install rehearsal: first-run step "${label}" was not shown`);
				}
			}
			const text = await readRunningAgent(first.page);
			console.log(`install rehearsal: the installed app reports running · package (${text.replace(/\s+/g, " ").trim().slice(0, 120)})`);
			evidence.onboarded = await first.page.evaluate(() => window.localStorage.getItem("spec.ai.jev.onboarded"));

			await first.page.locator('[data-testid="composer"]').fill(PROMPT);
			await first.page.locator('[data-testid="send"]').click();
			const answer = await first.page.locator('.message[data-role="assistant"] .text').last().textContent({ timeout: 120_000 });
			if (!answer?.includes(ANSWER)) throw new Error(`the installed app did not show the stub's answer, it shows: ${(answer ?? "").slice(0, 200)}`);
			evidence.userRows = await first.page.locator('.message[data-role="user"] .text').count();
			if (evidence.userRows !== 1) throw new Error(`the prompt is ${evidence.userRows} rows, not one`);
			if (!stub.streamed()) throw new Error("the harness never called the stub provider");
			console.log(`install rehearsal: the packaged app answered a turn (${answer.trim()}) and shows one row for the prompt`);

			// A setting a person changed: the upgrade must keep it, not just the conversation.
			await first.page.locator('[data-testid="nav-settings"]').click();
			await first.page.locator('[data-testid="settings"]').waitFor({ state: "visible", timeout: 60_000 });
			const box = first.page.locator('[data-option] input[type="checkbox"]').filter({ visible: true }).first();
			const option = await box.evaluate((node) => node.closest("[data-option]")?.getAttribute("data-option") ?? "");
			if (option === "") throw new Error("the settings screen shows no manifest option");
			const wasChecked = await box.isChecked();
			await box.click();
			await first.page.locator('[data-testid="settings-saved"]').waitFor({ state: "visible", timeout: 30_000 });
			evidence.setting = { option, value: !wasChecked };
			console.log(`install rehearsal: changed ${option} to ${!wasChecked} in the installed app`);
			await first.page.locator('[data-testid="nav-conversation"]').click();

			// A second start while the app is open: it must exit on its own and bring this window forward.
			const secondStart = spawn(executable, [`--user-data-dir=${profile}`], {
				env: isolatedEnvironment(home),
				stdio: "ignore",
			});
			const secondCode = await new Promise((resolve) => {
				const timer = setTimeout(() => {
					secondStart.kill();
					resolve(null);
				}, 30_000);
				secondStart.once("exit", (code) => {
					clearTimeout(timer);
					resolve(code);
				});
			});
			if (secondCode !== 0) throw new Error(`a second start exited ${secondCode}, not 0`);
			console.log("install rehearsal: a second start exits instead of opening a second copy");

			// A write outside the project: the kernel's guard asks, and the denial has to come back to the model.
			await first.page.locator('[data-testid="composer"]').fill("write a file outside the project");
			await first.page.locator('[data-testid="send"]').click();
			const card = first.page.locator('[data-testid="approval"]');
			await card.waitFor({ state: "visible", timeout: 120_000 });
			if (!(await card.textContent())?.includes("outside the project")) throw new Error("the card is not the write guard's");
			await card.locator('[data-testid="approval-option"]', { hasText: "Don't allow" }).click();
			// The row that says so, not "whatever the last answer was": the old answer is still on screen.
			const denial = first.page.locator('.message[data-role="assistant"] .text').filter({ hasText: "did not write it" });
			await denial.first().waitFor({ state: "visible", timeout: 120_000 });
			if (existsSync(deniedWrite)) throw new Error(`the denied write produced ${deniedWrite}`);
			if ((await card.count()) !== 0) throw new Error("the approval card is still on screen");
			await first.page.locator('.message[data-role="tool"] .text').first().waitFor({ state: "visible", timeout: 30_000 });
			const toolText = (await first.page.locator('.message[data-role="tool"] .text').first().textContent()) ?? "";
			if (!toolText.includes("(error)")) throw new Error(`the denied tool row says: ${toolText}`);
			evidence.userRows = await first.page.locator('.message[data-role="user"] .text').count();
			evidence.toolRows = await first.page.locator('.message[data-role="tool"] .text').count();
			console.log("install rehearsal: the write guard asks in the installed app, and the denial reaches the model");
		} finally {
			await first.app.close();
		}

		const sessions = sessionFiles(home);
		evidence.sessions = sessions.length;
		if (!sessions.some((file) => file.text.includes(PROMPT))) throw new Error("the turn is not in any session file under the temporary home");
		console.log(`install rehearsal: the turn is in a session file under the temporary home (${sessions.length} file(s))`);

		const log = join(home, ".spec.ai.jev", "agent", "logs", "spec-shell.log");
		if (!existsSync(log)) throw new Error(`the installed app wrote no shell log at ${log}`);
		const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
		const starts = lines.filter((line) => line.includes(" info started "));
		if (starts.length !== 1) throw new Error(`the shell logged ${starts.length} starts, not one: the second copy ran`);
		if (!lines.some((line) => line.includes("a second instance asked for the window"))) {
			throw new Error("the shell never recorded the second start");
		}
		console.log(`install rehearsal: shell log in the temporary home, ${lines.length} lines, one start and the second-instance line`);

		if (JSON.stringify(agentFingerprint(realHome)) !== JSON.stringify(evidence.agentBefore)) {
			throw new Error("the rehearsal changed the real agent folder");
		}
		if ((existsSync(realLog) ? statSync(realLog).mtimeMs : 0) !== realLogBefore) throw new Error("the rehearsal wrote the real shell log");
		console.log("install rehearsal: the real home was not touched");

		if (nextInstaller !== undefined) {
			// The conversation the first install produced is what an upgrade must not lose.
			const before = sessions;
			const settingsPath = join(home, ".spec.ai.jev", "agent", "agent.json");
			const settingsBefore = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "";
			if (settingsBefore === "") throw new Error("the rehearsal changed no setting, so there is no agent.json for the upgrade to keep");

			evidence.nextInstaller = statSync(nextInstaller).size;
			installInto(nextInstaller, installDir);
			const upgraded = join(installDir, "spec.ai.jev.exe");
			evidence.nextFileVersion = fileVersion(upgraded);
			const version = `v${evidence.nextFileVersion}`;
			console.log(`install rehearsal: ${evidence.fileVersion} upgraded in place by ${evidence.nextFileVersion}`);

			const second = await openInstalled(upgraded, profile, home);
			try {
				const text = await readRunningAgent(second.page);
				if (!text.includes(version)) throw new Error(`the upgraded app does not show ${version}:\n${text.slice(0, 300)}`);
				if ((await second.page.locator('[data-testid="first-run"]').count()) !== 0) {
					throw new Error("the first-run wizard came back after the upgrade");
				}
				const onboarded = await second.page.evaluate(() => window.localStorage.getItem("spec.ai.jev.onboarded"));
				if (onboarded !== "1") throw new Error(`the profile lost its onboarding: spec.ai.jev.onboarded=${onboarded}`);
				const after = sessionFiles(home);
				for (const file of before) {
					const now = after.find((candidate) => candidate.path === file.path);
					if (now === undefined) throw new Error(`the session file ${file.path} is gone after the upgrade`);
					if (now.text !== file.text) throw new Error(`the session file ${file.path} changed across the upgrade`);
				}
				const settingsAfter = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "";
				if (settingsAfter !== settingsBefore) throw new Error("agent.json changed across the upgrade");
				if (evidence.setting !== undefined) {
					await second.page.locator('[data-testid="nav-settings"]').click();
					await second.page.locator('[data-testid="settings"]').waitFor({ state: "visible", timeout: 60_000 });
					const kept = await second.page.locator(`[data-option="${evidence.setting.option}"] input[type="checkbox"]`).isChecked();
					if (kept !== evidence.setting.value) throw new Error(`the upgraded app shows ${evidence.setting.option} as ${kept}`);
				}
				console.log(`install rehearsal: upgraded to ${evidence.nextFileVersion} without the wizard, with the session file of the real turn and the changed setting intact`);
			} finally {
				await second.app.close();
			}
		}

		const uninstaller = join(installDir, "Uninstall spec.ai.jev.exe");
		if (!existsSync(uninstaller)) throw new Error("the install directory has no uninstaller");
		const uninstall = spawnSync(uninstaller, ["/S"], { stdio: "inherit", timeout: 300_000 });
		if (uninstall.status !== 0) throw new Error(`the silent uninstall exited ${uninstall.status}`);
		const deadline = Date.now() + 120_000;
		while (existsSync(installDir) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
		if (existsSync(installDir)) throw new Error(`the install directory is still there: ${readdirSync(installDir).join(", ")}`);
		console.log("install rehearsal: the install directory is gone");
		const stillOurs = specState().filter((entry) => entry.target.includes(installDir));
		if (stillOurs.length > 0) {
			throw new Error(`the uninstaller left ${stillOurs.map((entry) => `${entry.kind} ${entry.path}`).join(" | ")} behind`);
		}
		if (machineState().some((line) => line.includes(installDir))) throw new Error("the uninstaller left a machine-wide entry behind");
		// User data is not the uninstaller's to remove: the conversation has to still be there.
		const kept = sessionFiles(home);
		if (!kept.some((file) => file.text.includes(PROMPT))) throw new Error("the uninstaller removed the conversation from the temporary home");
		evidence.sessionsAfterUninstall = kept.length;
		console.log("install rehearsal: no uninstall entry and no Start Menu shortcut left behind; the conversation is still there");
		console.log(`install rehearsal: ${JSON.stringify(evidence)}`);
	} finally {
		stub.close();
		rmSync(deniedWrite, { force: true });
		// A rehearsal that stopped half way must not leave a registered install pointing at a deleted folder.
		const uninstaller = join(installDir, "Uninstall spec.ai.jev.exe");
		if (existsSync(uninstaller)) {
			spawnSync(uninstaller, ["/S"], { stdio: "ignore", timeout: 120_000 });
			const deadline = Date.now() + 30_000;
			while (existsSync(installDir) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
		}
		if (snapshot !== undefined) restoreState(snapshot);
		rmSync(root, { recursive: true, force: true });
	}
}

try {
	await main();
} catch (error) {
	console.error(`install rehearsal: FAILED: ${(error instanceof Error ? error.message : String(error)).slice(0, 1500)}`);
	process.exitCode = 1;
}
