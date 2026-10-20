// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The wire between the renderer, the preload script, and the main process.
 *
 * Every capability is a named method: there is no generic `invoke(channel, payload)`, because a generic bridge
 * turns any renderer-side bug into arbitrary main-process code. The main process keeps the same list as its
 * allow-list of IPC channels (`src/main/ipc.ts`), and the preload is the only place that touches `ipcRenderer`.
 *
 * These types are also what the renderer sees as `window.spec`; `declare global` here keeps the three sides on one
 * definition instead of three near-copies.
 */

import type { HistoryMessage } from "./conversation.ts";
import type { FilePreview, SavedFile } from "./files.ts";
import type { SettingsChange, SettingsSnapshot } from "./settings.ts";
import type { UpdateCheckResult, UpdateInstallOutcome } from "./update.ts";

/** What the app knows about the agent process. `failed` is the one that shows an error screen. */
export type HarnessStatus =
	| { readonly state: "stopped" }
	| { readonly state: "starting" }
	| {
			readonly state: "running";
			readonly root: string;
			readonly layout: "repo" | "package";
			readonly pid: number | undefined;
	  }
	| {
			readonly state: "restarting";
			readonly attempt: number;
			readonly of: number;
			readonly delayMs: number;
			readonly reason: string;
	  }
	| {
			readonly state: "failed";
			readonly reason: string;
			/** Where spec.ai.jev should have been, so the screen can say what to do. */
			readonly expected: { readonly root: string; readonly layout: "repo" | "package" };
			/** The tail of the agent's stderr, newest last. */
			readonly stderr: readonly string[];
	  };

/** One line of the agent's stdout that is not a response to us: it is an event, passed through unchanged. */
export interface AgentEvent {
	readonly type: string;
	readonly [key: string]: unknown;
}

/**
 * What a prompt was accepted as. pi's `PromptDisposition` (`core/agent-session.ts:301`) is `"started" | "handled" |
 * "queued"`; `"handled"` means no run started, so the UI must not wait for the turn to settle.
 */
export type PromptDisposition = "started" | "queued" | "handled";

export interface PromptResult {
	readonly disposition: PromptDisposition;
}

/**
 * An image on its way into a prompt: base64 data without the `data:` prefix, and the type the model is told.
 *
 * Only raster formats the providers accept, and only as much as a message can carry; the bridge enforces both, because
 * a renderer-side check is a convenience, not a boundary.
 */
export interface PromptImage {
	readonly mimeType: string;
	readonly data: string;
}

/** What the composer accepts, in one place: the page and the bridge read the same list. */
export const PROMPT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_PROMPT_IMAGES = 6;
/** ~5 MB decoded, which is what the providers take for one image. */
export const MAX_PROMPT_IMAGE_CHARS = 7_000_000;

/** A loaded agent session, as the renderer needs it. */
export interface SessionSnapshot {
	readonly sessionId: string;
	readonly sessionFile?: string;
	readonly sessionName?: string;
	readonly model: string | undefined;
	readonly thinkingLevel: string;
	readonly isStreaming: boolean;
	readonly messageCount: number;
}

export type Unsubscribe = () => void;

/** A model the harness says it can use, as the first-run screen offers it. */
export interface ModelChoice {
	readonly provider: string;
	readonly id: string;
}

/** One saved session in this app's agent folder. */
export interface SessionSummary {
	readonly path: string;
	readonly id: string;
	readonly title: string;
	readonly cwd: string;
	readonly updatedAt: string;
}

export type { FilePreview, SavedFile } from "./files.ts";

/** The folder the agent runs in, and the result of choosing a different one. */
export interface WorkspaceState {
	readonly path: string;
}

/** One file the quick-open list offers: relative to the project root, with `/` separators. */
export interface FileHit {
	readonly path: string;
	readonly name: string;
	readonly score: number;
}

export interface WorkspaceChoice extends WorkspaceState {
	readonly cancelled: boolean;
	readonly status: HarnessStatus;
}

/** The answer to a pending UI request: one of a value, a confirmation, or a cancellation. */
export interface UiAnswer {
	readonly id: string;
	readonly value?: string;
	readonly confirmed?: boolean;
	readonly cancelled?: true;
}

/** One decision from spec.ai.jev's ledger, as `spec ledger --json` prints it. */
export interface JudgmentRecord {
	readonly id: string;
	readonly specId: string;
	readonly mode: string;
	readonly providerId: string;
	readonly timestamp?: string;
	readonly source?: string;
	readonly userMessage?: string;
}

/** The judge's consent, as the kernel stores it. `fromEnvironment` means `SPEC_AI_JEV_JUDGE_CONSENT=1` for this run. */
export interface ConsentState {
	readonly granted: boolean;
	readonly fromEnvironment: boolean;
	readonly agreedAt: string | undefined;
	readonly file: string;
}

/** The capabilities the preload exposes. Anything not here does not exist for the page. */
export interface SpecApi {
	readonly app: {
		version(): Promise<string>;
		platform(): Promise<string>;
		/** The window's zoom level, in the same units `setZoom` takes. */
		zoom(): Promise<number>;
		/** Zoom the window; the main process clamps it and answers with what it applied. */
		setZoom(level: number): Promise<number>;
		/** Put text on the system clipboard; the page itself has no clipboard permission. */
		copy(text: string): Promise<void>;
	};
	readonly harness: {
		status(): Promise<HarnessStatus>;
		onStatus(listener: (status: HarnessStatus) => void): Unsubscribe;
		/** Restart the agent after the user fixed something the failure screen pointed at. */
		restart(): Promise<HarnessStatus>;
		stop(): Promise<void>;
		prompt(message: string, images?: readonly PromptImage[]): Promise<PromptResult>;
		abort(): Promise<void>;
		snapshot(): Promise<SessionSnapshot>;
		/** The session's existing messages, so a window that opens into a running session is not blank. */
		history(): Promise<readonly HistoryMessage[]>;
		/** Start a fresh session, which is what "new conversation" means to the harness. */
		newSession(): Promise<void>;
		models(): Promise<readonly ModelChoice[]>;
		setModel(provider: string, modelId: string): Promise<void>;
		/** Answer a request the harness is blocked on (an approval, a select, an input). */
		respond(answer: UiAnswer): Promise<void>;
		onEvent(listener: (event: AgentEvent) => void): Unsubscribe;
	};
	readonly workspace: {
		/** The folder the next agent turn runs in. */
		current(): Promise<WorkspaceState>;
		/** Ask for a folder, then restart the agent in it. Cancellation leaves the current session alone. */
		choose(): Promise<WorkspaceChoice>;
		/** Open a known folder, then restart the agent in it. */
		open(path: string): Promise<WorkspaceChoice>;
		/** Read a text file inside the current project for the Files panel. */
		readFile(path: string): Promise<FilePreview>;
		/** Save an edit to a file the panel read, quoting the hash it was read at. */
		saveFile(path: string, text: string, expectedHash: string): Promise<SavedFile>;
		/** Files in the current project whose names answer the query, best first. */
		searchFiles(query: string): Promise<readonly FileHit[]>;
	};
	readonly sessions: {
		/** Saved sessions for the current workspace, newest first. */
		list(): Promise<readonly SessionSummary[]>;
		/** Every saved session, newest first, whatever project folder it belongs to. */
		listAll(): Promise<readonly SessionSummary[]>;
		/** Switch the running agent to a saved session by its absolute JSONL path. */
		open(path: string): Promise<void>;
		/** Open a session in the project it belongs to: restart the agent there, then switch to the session. */
		openAcross(path: string): Promise<WorkspaceState>;
		/** Delete one saved session. A session the agent has open is left first, so nothing keeps writing to it. */
		remove(path: string): Promise<{ readonly deleted: boolean }>;
		/** Give the current session a stable display name. */
		rename(name: string): Promise<void>;
	};
	readonly judgments: {
		/** The last decisions from spec.ai.jev's ledger, newest last. Its own data source: `spec ledger --json`. */
		recent(): Promise<readonly JudgmentRecord[]>;
	};
	readonly update: {
		/** Ask the configured feed whether a newer build exists, and say what stopped it if not. */
		check(): Promise<UpdateCheckResult>;
		/** Download, prove and start the installer. Refuses with a sentence when it cannot prove the artifact. */
		install(): Promise<UpdateInstallOutcome>;
	};
	readonly settings: {
		/** The harness's manifest, the settings in effect, and where a change would be written. */
		snapshot(): Promise<SettingsSnapshot>;
		write(change: SettingsChange): Promise<SettingsSnapshot>;
	};
	readonly consent: {
		status(): Promise<ConsentState>;
		/** Grant through the harness's own command, so the file is written by the code that reads it. */
		grant(): Promise<ConsentState>;
		revoke(): Promise<ConsentState>;
	};
	readonly preview: {
		open(url: string): Promise<void>;
		close(): Promise<void>;
	};
}

/** The exact channel names, in one place: main registers them, preload calls them, a test compares both lists. */
export const IPC_CHANNELS = {
	appVersion: "app:version",
	appPlatform: "app:platform",
	appZoom: "app:zoom",
	appSetZoom: "app:set-zoom",
	appCopy: "app:copy",
	harnessStatus: "harness:status",
	harnessRestart: "harness:restart",
	harnessStop: "harness:stop",
	harnessPrompt: "harness:prompt",
	harnessAbort: "harness:abort",
	harnessSnapshot: "harness:snapshot",
	harnessHistory: "harness:history",
	harnessNewSession: "harness:new-session",
	harnessModels: "harness:models",
	harnessSetModel: "harness:set-model",
	harnessUiResponse: "harness:ui-response",
	workspaceCurrent: "workspace:current",
	workspaceChoose: "workspace:choose",
	workspaceOpen: "workspace:open",
	workspaceReadFile: "workspace:read-file",
	workspaceSaveFile: "workspace:write-file",
	workspaceSearchFiles: "workspace:search-files",
	sessionsList: "sessions:list",
	sessionsListAll: "sessions:list-all",
	sessionsOpen: "sessions:open",
	sessionsOpenAcross: "sessions:open-across",
	sessionsRemove: "sessions:remove",
	sessionsRename: "sessions:rename",
	judgmentsRecent: "judgments:recent",
	updateCheck: "update:check",
	updateInstall: "update:install",
	settingsSnapshot: "settings:snapshot",
	settingsWrite: "settings:write",
	consentStatus: "consent:status",
	consentGrant: "consent:grant",
	consentRevoke: "consent:revoke",
	previewOpen: "preview:open",
	previewClose: "preview:close",
	/** Main → renderer. */
	harnessStatusEvent: "harness:status-changed",
	harnessAgentEvent: "harness:agent-event",
} as const;

/** The channels a page may call. The status/event channels are main → renderer only. */
export const INVOKE_CHANNELS = [
	IPC_CHANNELS.appVersion,
	IPC_CHANNELS.appPlatform,
	IPC_CHANNELS.appZoom,
	IPC_CHANNELS.appSetZoom,
	IPC_CHANNELS.appCopy,
	IPC_CHANNELS.harnessStatus,
	IPC_CHANNELS.harnessRestart,
	IPC_CHANNELS.harnessStop,
	IPC_CHANNELS.harnessPrompt,
	IPC_CHANNELS.harnessAbort,
	IPC_CHANNELS.harnessSnapshot,
	IPC_CHANNELS.harnessHistory,
	IPC_CHANNELS.harnessNewSession,
	IPC_CHANNELS.harnessModels,
	IPC_CHANNELS.harnessSetModel,
	IPC_CHANNELS.harnessUiResponse,
	IPC_CHANNELS.workspaceCurrent,
	IPC_CHANNELS.workspaceChoose,
	IPC_CHANNELS.workspaceOpen,
	IPC_CHANNELS.workspaceReadFile,
	IPC_CHANNELS.workspaceSaveFile,
	IPC_CHANNELS.workspaceSearchFiles,
	IPC_CHANNELS.sessionsList,
	IPC_CHANNELS.sessionsListAll,
	IPC_CHANNELS.sessionsOpen,
	IPC_CHANNELS.sessionsOpenAcross,
	IPC_CHANNELS.sessionsRemove,
	IPC_CHANNELS.sessionsRename,
	IPC_CHANNELS.judgmentsRecent,
	IPC_CHANNELS.updateCheck,
	IPC_CHANNELS.updateInstall,
	IPC_CHANNELS.settingsSnapshot,
	IPC_CHANNELS.settingsWrite,
	IPC_CHANNELS.consentStatus,
	IPC_CHANNELS.consentGrant,
	IPC_CHANNELS.consentRevoke,
	IPC_CHANNELS.previewOpen,
	IPC_CHANNELS.previewClose,
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

/** The channels main pushes to the page. */
export const EVENT_CHANNELS = [IPC_CHANNELS.harnessStatusEvent, IPC_CHANNELS.harnessAgentEvent] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];

/** Why a call failed, in a shape the renderer can branch on instead of parsing messages. */
export interface ApiFailure {
	readonly code: "unknown-channel" | "invalid-payload" | "not-running" | "conflict" | "failed";
	readonly message: string;
}

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiFailure };

declare global {
	interface Window {
		/** Injected by the preload; absent in any page that is not ours. */
		readonly spec: SpecApi;
	}
}
