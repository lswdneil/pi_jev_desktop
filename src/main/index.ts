// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The main process: one window on the app's own origin, one agent process behind a supervisor, one allow-listed
 * bridge between them.
 *
 * Order matters here, and this is the part the old shell got wrong. `protocol.registerSchemesAsPrivileged` must run
 * before the app is ready, or the scheme is inert and the window loads from `file://` with no origin to bind a policy
 * to. The policy is then set on every response the scheme handler produces, so a document cannot exist without it.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BrowserWindow, Menu, app, dialog, ipcMain, protocol, session } from "electron";
import { IPC_CHANNELS, type JudgmentRecord } from "../shared/api.ts";
import { artifactUrl } from "../shared/update.ts";
import { APP_SCHEME, resolveAppRequest } from "./app-protocol.ts";
import { spawnAgentProcess } from "./agent-process.ts";
import { consentState, runConsentCommand, runHarnessCommand } from "./consent.ts";
import { expectedHarness, type Harness, findHarness, launchCommand } from "./harness.ts";
import { createApi } from "./ipc.ts";
import { isPreviewContents, PreviewPanel } from "./preview.ts";
import { APP_ORIGIN, appPermission, contentSecurityPolicy, developmentCsp, isAllowedNavigation, windowPreferences } from "./security.ts";
import {
	appendShellLog,
	formatShellLogLine,
	shellLogPath,
	type ShellLogLevel,
} from "./shell-log.ts";
import {
	agentDirFor,
	applyChange,
	consentFileFor,
	findManifest,
	readManifest,
	readSettings,
	settingsFileFor,
	writeSettings,
} from "./settings.ts";
import { AgentSupervisor } from "./supervisor.ts";
import { checkForUpdate } from "./update.ts";
import { installUpdate } from "./update-install.ts";
import { launchInstaller } from "./update-launcher.ts";
import { appVersion } from "./version.ts";

/** Before `app.whenReady`: a scheme registered later is not privileged, and `app://` pages get no origin. */
protocol.registerSchemesAsPrivileged([
	{
		scheme: APP_SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
	},
]);

const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const development = devServerUrl !== undefined;
/** `out/main/index.js` → `out/renderer`: the build's own folder, never the sources. */
const rendererRoot = join(__dirname, "..", "renderer");
const preloadPath = join(__dirname, "..", "preload", "main.js");
/** The desktop's own folder in a checkout; nothing to sit beside once packaged. */
const desktopRoot = app.isPackaged ? undefined : join(__dirname, "..", "..");
const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
const policy = contentSecurityPolicy(
	devServerUrl === undefined ? { development: false } : { development: true, devServerOrigin: devServerUrl },
);

/**
 * The folder the agent runs in. A project selected from the rail wins; a checkout defaults to its own root, and a
 * packaged app defaults to the user's home folder until the person opens a project.
 */
let workspaceRoot = (process.env.MU_WORKSPACE ?? "").trim() || undefined;

function defaultWorkspace(harness: Harness): string {
	return harness.layout === "repo" ? harness.root : homedir();
}

function currentWorkspace(harness: Harness): string {
	return workspaceRoot ?? defaultWorkspace(harness);
}

/** How to run the harness's own command line (no `--mode rpc`): the same executable and launcher, a subcommand. */
function cliLaunch(harness: Harness): { command: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> } {
	const command = launchCommand(harness, {
		platform: process.platform,
		processExecPath: process.execPath,
		packaged: app.isPackaged,
	});
	return {
		command: command.command,
		args: command.args,
		cwd: currentWorkspace(harness),
		env: command.env,
	};
}

const supervisor = new AgentSupervisor({
	locate: () => findHarness(desktopRoot),
	launchOf: (harness) => {
		const base = cliLaunch(harness);
		return {
			...base,
			// `--mode rpc` is the agent's JSONL mode; without it the process would wait on a terminal instead of a pipe.
			args: [...base.args, "--mode", "rpc"],
		};
	},
	expected: () => expectedHarness(desktopRoot, resourcesPath, process.platform),
	spawn: spawnAgentProcess,
	onChange: (status) => {
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.send(IPC_CHANNELS.harnessStatusEvent, status);
		}
	},
	onEvent: (event) => {
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.send(IPC_CHANNELS.harnessAgentEvent, event);
		}
	},
});

/** The harness in use, or an error a screen can show. Settings and consent both belong to a specific harness. */
function currentHarness(): Harness {
	const harness = findHarness(desktopRoot);
	if (harness === undefined) throw new Error("mu was not found, so its settings cannot be read");
	return harness;
}

/** Where this harness keeps the manifest that describes its settings. */
function manifestFile(): string {
	const harness = currentHarness();
	const file = findManifest(harness.root, process.platform, existsSync);
	if (file === undefined) throw new Error(`${harness.root} has no kernel manifest.json, so there are no settings to show`);
	return file;
}

const settings = {
	async snapshot(): Promise<unknown> {
		const manifest = readManifest(manifestFile());
		const path = settingsFileFor(homedir(), process.platform);
		const { document, problems } = readSettings(path);
		return { manifest, document, path, problems };
	},
	async write(change: Parameters<typeof applyChange>[2]): Promise<unknown> {
		const manifest = readManifest(manifestFile());
		const path = settingsFileFor(homedir(), process.platform);
		const { document, problems } = readSettings(path);
		const next = applyChange(document, manifest, change);
		writeSettings(path, next);
		return { manifest, document: next, path, problems };
	},
};

const consent = {
	async status(): Promise<unknown> {
		return consentState(consentFileFor(homedir(), process.platform), process.env);
	},
	async grant(): Promise<unknown> {
		const result = await runConsentCommand({ launch: cliLaunch(currentHarness()), spawn: spawnAgentProcess, action: "accept" });
		if (!result.ok) throw new Error(result.output.trim() === "" ? "mu judge consent accept failed" : result.output.trim());
		return consent.status();
	},
	async revoke(): Promise<unknown> {
		const result = await runConsentCommand({ launch: cliLaunch(currentHarness()), spawn: spawnAgentProcess, action: "revoke" });
		if (!result.ok) throw new Error(result.output.trim() === "" ? "mu judge consent revoke failed" : result.output.trim());
		return consent.status();
	},
};

const workspace = {
	async current(): Promise<{ path: string }> {
		return { path: currentWorkspace(currentHarness()) };
	},
	async choose(): Promise<{ path: string; cancelled: boolean; status: unknown }> {
		const harness = currentHarness();
		const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
		const chosen = result.filePaths[0];
		if (result.canceled || chosen === undefined) {
			return { path: currentWorkspace(harness), cancelled: true, status: supervisor.getStatus() };
		}
		workspaceRoot = chosen;
		const status = await supervisor.restart();
		return { path: chosen, cancelled: false, status };
	},
};

/**
 * The judgments panel's own source: `mu ledger --json`, which the kernel already provides and keeps in step with the
 * ledger format. Reading the file directly would be a second parser for the same lines.
 */
const judgments = {
	async recent(): Promise<readonly JudgmentRecord[]> {
		const result = await runHarnessCommand({ launch: cliLaunch(currentHarness()), spawn: spawnAgentProcess, args: ["ledger", "--json"] });
		if (!result.ok) throw new Error(result.output.trim() === "" ? "mu ledger --json failed" : result.output.trim());
		const records: JudgmentRecord[] = [];
		for (const line of result.output.split("\n")) {
			const text = line.trim();
			if (text === "" || !text.startsWith("{")) continue;
			try {
				const value = JSON.parse(text) as Record<string, unknown>;
				if (typeof value.id !== "string" || typeof value.specId !== "string") continue;
				records.push({
					id: value.id,
					specId: value.specId,
					mode: typeof value.mode === "string" ? value.mode : "active",
					providerId: typeof value.providerId === "string" ? value.providerId : "unknown",
					...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
					...(typeof value.source === "string" ? { source: value.source } : {}),
					...(typeof value.userMessage === "string" ? { userMessage: value.userMessage.slice(0, 160) } : {}),
				});
			} catch {
				// A line that is not JSON is the command talking to a person, not a record.
			}
		}
		return records.slice(-50);
	},
};

/**
 * The preview belongs to the window, which does not exist yet when the API is built. The holder keeps the API's
 * shape fixed while the panel comes and goes with the window.
 */
const previewPanel: { current: PreviewPanel | undefined } = { current: undefined };

/** The version the window shows and the updater compares against: this build's, not Electron's. */
const version = appVersion({ buildRoot: __dirname, electronVersion: app.getVersion() });

/**
 * Updates are checked on request, never installed by this build: the feed is read, verified and reported, and the
 * installer step waits for the release pipeline's signing (U10). A check that cannot verify says why instead of
 * pretending the build is current.
 */
const update = {
	async check(): Promise<unknown> {
		return checkForUpdate({ currentVersion: version, requireSignature: app.isPackaged });
	},
	async install(): Promise<unknown> {
		const check = await checkForUpdate({ currentVersion: version, requireSignature: app.isPackaged });
		if (check.status.state !== "available") {
			return { state: "refused", reason: check.status.state === "up-to-date" ? "this build is already current" : check.status.reason };
		}
		return installUpdate({
			url: artifactUrl(check.feedUrl, check.status.file.url),
			file: check.status.file,
			launch: launchInstaller,
		});
	},
};

const api = createApi({
	version,
	platform: process.platform,
	supervisor,
	workspace,
	settings,
	consent,
	judgments,
	update,
	preview: {
		open: async (url) => {
			const panel = previewPanel.current;
			if (panel === undefined) throw new Error("the preview needs a window");
			await panel.open(url);
		},
		close: async () => previewPanel.current?.close(),
	},
});

/** Server the build output over `app://mu`, with the policy attached to every response. */
function registerAppScheme(): void {
	protocol.handle(APP_SCHEME, async (request) => {
		const resolved = resolveAppRequest(request.url, rendererRoot, process.platform);
		if (resolved.kind === "refused") {
			return new Response(resolved.reason, {
				status: resolved.status,
				headers: { "content-type": "text/plain; charset=utf-8", "content-security-policy": policy },
			});
		}
		try {
			const body = await readFile(resolved.file);
			return new Response(new Uint8Array(body), {
				status: 200,
				headers: { "content-type": resolved.contentType, "content-security-policy": policy },
			});
		} catch {
			return new Response("not found", {
				status: 404,
				headers: { "content-type": "text/plain; charset=utf-8", "content-security-policy": policy },
			});
		}
	});
}

/** Register the bridge. Only these channels exist; anything else has no handler at all. */
function registerBridge(): void {
	for (const channel of api.channels) {
		ipcMain.handle(channel, async (event, payload: unknown) => {
			// A frame that is not ours (an iframe, a preview) must not reach the main process through this bridge.
			if (!isOwnFrame(event.senderFrame?.url)) {
				return { ok: false, error: { code: "unknown-channel", message: "this frame may not call the bridge" } };
			}
			return api.dispatch(channel, payload);
		});
	}
}

function isOwnFrame(url: string | undefined): boolean {
	if (url === undefined) return false;
	if (development && devServerUrl !== undefined) return url.startsWith(devServerUrl);
	return url.startsWith(`${APP_ORIGIN}/`);
}

/** Development only: the Vite dev server's documents carry no policy of their own, so it is added on the way in. */
function applyDevelopmentPolicy(): void {
	if (devServerUrl === undefined) return;
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [developmentCsp(devServerUrl)],
			},
		});
	});
}

/**
 * The guards every WebContents in this app gets, attached centrally as well as per view.
 *
 * Both rules were already applied to the window and to the preview, one object at a time. That works until the third
 * WebContents appears — a print view, a devtools window, a future panel — and inherits nothing: the previous round found
 * exactly this shape of hole where a session was created and never hardened. `app.on("web-contents-created")` is the
 * hook that cannot be forgotten, because it runs for every one of them, including the ones Electron creates itself.
 *
 * Navigation is the one rule that cannot be stated once for all of them: the preview is allowed to follow http(s) links,
 * and it decides that per navigation in `preview.ts`. So the central guard asks the preview registry before refusing.
 */
export function guardContents(contents: Electron.WebContents): void {
	contents.setWindowOpenHandler(() => ({ action: "deny" }));
	contents.on("will-navigate", (event, url) => {
		if (isAllowedNavigation(url)) return;
		if (development && devServerUrl !== undefined && url.startsWith(devServerUrl)) return;
		// A preview follows http(s) links; its own listener refuses everything else.
		if (isPreviewContents(contents.id)) return;
		event.preventDefault();
	});
}

/** Where the shell records what happened; `shell-log.ts` says what belongs in a line. */
type ShellLogger = (level: ShellLogLevel, message: string, details?: Readonly<Record<string, unknown>>) => void;

/**
 * This app's agent folder: settings, consent, sessions and the log all live under `~/.spec.ai.jev/agent`.
 *
 * `mu` (the command line) and `spec.ai.jev` (this app) are two products with their own state, so the kernel is told
 * `MU_AGENT_DIR` (`packages/kyrn-judge/src/main.ts` reads it before its `~/.mu/agent` default) and never touches a
 * user's `~/.mu`. Nothing migrates: an existing command-line installation keeps its files where they are.
 */
const agentDir = agentDirFor(homedir(), process.platform);
if ((process.env.MU_AGENT_DIR ?? "").trim() === "") process.env.MU_AGENT_DIR = agentDir;

/** The one file the shell writes; the crash dialog names it, so both paths agree by construction. */
const logFile = shellLogPath(agentDir);

/**
 * How many windows this run has replaced after their renderer was gone. The budget belongs to the run, not to a
 * window: a per-window counter never runs out when every crash takes the window with it, which is exactly the loop
 * the limit exists to stop.
 */
let rendererRecoveries = 0;

function createWindow(log: ShellLogger): BrowserWindow {
	const window = new BrowserWindow({
		width: 1180,
		height: 780,
		minWidth: 720,
		minHeight: 480,
		show: false,
		backgroundColor: "#101014",
		title: "spec.ai.jev",
		webPreferences: windowPreferences(preloadPath),
	});

	window.once("ready-to-show", () => window.show());
	// Nothing opens a second window: a link either stays inside the app or does not open.
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event, url) => {
		if (isAllowedNavigation(url) || (development && devServerUrl !== undefined && url.startsWith(devServerUrl))) return;
		event.preventDefault();
	});
	// A crashed renderer cannot be revived in place: the window is replaced with a fresh one. The app-level handler is
	// what records the crash; this one recovers from it, at most twice per run, so a page that crashes on load cannot
	// loop. `rendererRecoveries` is the run's budget, not this window's (see its declaration).
	window.webContents.on("render-process-gone", (_event, details) => {
		if (details.reason === "clean-exit" || window.isDestroyed()) return;
		if (rendererRecoveries >= 2) {
			log("error", "the window is not being replaced again after repeated renderer crashes", { recoveries: rendererRecoveries });
			// A page that has crashed three times will crash a fourth, and a window that only reproduces the crash is
			// worse than none: it looks like the app is working. What the person gets instead is one sentence and the
			// log's path, drawn by the main process because the window that died cannot draw it any more.
			void dialog.showMessageBox({
				type: "error",
				title: "spec.ai.jev",
				message: "The spec.ai.jev window keeps crashing.",
				detail: `The window will not be restored again. Quit spec.ai.jev and start it once more. If it keeps happening, the log at ${logFile} is what makes a report checkable.`,
			});
			return;
		}
		rendererRecoveries += 1;
		log("warn", "replacing the window after its renderer was gone", { recovery: rendererRecoveries });
		// The replacement is created before the old window goes, so `window-all-closed` never sees a moment with none.
		setImmediate(() => {
			if (window.isDestroyed()) return;
			const replacement = createWindow(log);
			window.destroy();
			replacement.focus();
		});
	});
	// A window that stops answering is a thing a person sees and reports; the log is what makes the report checkable.
	window.on("unresponsive", () => log("warn", "the window is unresponsive"));
	window.on("responsive", () => log("info", "the window is responsive again"));

	const preview = new PreviewPanel(window);
	previewPanel.current = preview;

	if (devServerUrl === undefined) {
		void window.loadURL(`${APP_ORIGIN}/index.html`);
	} else {
		void window.loadURL(devServerUrl);
	}
	return window;
}

async function main(): Promise<void> {
	if (!app.requestSingleInstanceLock()) {
		app.quit();
		return;
	}
	Menu.setApplicationMenu(null);
	await app.whenReady();

	registerAppScheme();
	applyDevelopmentPolicy();
	registerBridge();
	// Electron grants a permission request when no handler is set, and the app's own page needs none of them; see
	// `appPermission` for why the default is denial here as well.
	session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
		callback(appPermission(permission).allow);
	});
	session.defaultSession.setPermissionCheckHandler((_contents, permission) => appPermission(permission).allow);
	// Every WebContents, not only the ones created below: the guard is the one thing a future panel cannot forget.
	app.on("web-contents-created", (_event, contents) => guardContents(contents));

	// A packaged app has no console: without this file an error in the shell leaves nothing to inspect. It sits in the
	// agent's `logs` folder, which `mu doctor --bundle` already collects, so a report can carry it.
	const log: ShellLogger = (level, message, details) => {
		try {
			appendShellLog(logFile, formatShellLogLine(level, message, details));
		} catch {
			// A log that cannot be written must not take the app down; the shell works without a trace.
		}
	};
	log("info", "started", { version: app.getVersion(), platform: process.platform, arch: process.arch });
	// The lock above keeps a second copy from opening over the same profile; this is what the second copy gets instead:
	// the window that already exists, brought forward. Without it, clicking the icon twice looks like nothing happened.
	app.on("second-instance", () => {
		const existing = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
		if (existing === undefined) {
			createWindow(log);
			return;
		}
		if (existing.isMinimized()) existing.restore();
		existing.show();
		existing.focus();
		log("info", "a second instance asked for the window");
	});
	process.on("uncaughtException", (error) => {
		log("fatal", "uncaught exception", { message: error.message, stack: error.stack });
		app.exit(1);
	});
	process.on("unhandledRejection", (reason) => {
		log("fatal", "unhandled rejection", { reason: String(reason) });
		app.exit(1);
	});
	app.on("render-process-gone", (_event, contents, details) => {
		log("error", "a renderer process is gone", {
			reason: details.reason,
			exitCode: details.exitCode,
			preview: isPreviewContents(contents.id),
			// Without the query or fragment: a preview can be showing a link that carries one, and it is not ours to keep.
			url: contents.getURL().replace(/[?#].*$/, ""),
		});
	});
	app.on("child-process-gone", (_event, details) => {
		log("error", "a child process is gone", { type: details.type, reason: details.reason, exitCode: details.exitCode });
	});
	app.on("will-quit", () => log("info", "quitting"));
	createWindow(log);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow(log);
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	// The agent is a child of this process: it must not outlive it, and a quit must not wait for it.
	app.on("before-quit", () => {
		void supervisor.stop();
	});

	await supervisor.start();
}

void main();
