// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The page's only door to the main process.
 *
 * This file runs sandboxed (`security.ts` `windowPreferences`): no Node built-ins, no `require`, no filesystem. Each
 * capability is a named method below, so the page cannot reach a channel we did not write out here — there is no
 * generic `invoke(channel, payload)` to find.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
	type AgentEvent,
	type ApiResult,
	type ConsentState,
	EVENT_CHANNELS,
	type EventChannel,
	type FilePreview,
	type HarnessStatus,
	IPC_CHANNELS,
	type InvokeChannel,
	type ModelChoice,
	type MuApi,
	type JudgmentRecord,
	type PromptResult,
	type SavedFile,
	type SessionSnapshot,
	type SessionSummary,
	type UiAnswer,
	type Unsubscribe,
	type WorkspaceChoice,
	type WorkspaceState,
} from "../shared/api.ts";
import type { HistoryMessage } from "../shared/conversation.ts";
import type { SettingsChange, SettingsSnapshot } from "../shared/settings.ts";
import type { UpdateCheck, UpdateInstallOutcome } from "../shared/update.ts";

/** Call one allow-listed channel; a refusal from the main process becomes a rejected promise the page can catch. */
async function invoke<T>(channel: InvokeChannel, payload?: unknown): Promise<T> {
	const result = (await ipcRenderer.invoke(channel, payload)) as ApiResult<T>;
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
}

/** Listen to one of the two channels main pushes on, and stop listening when the page says so. */
function subscribe<T>(channel: EventChannel, listener: (value: T) => void): Unsubscribe {
	if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error(`not an event channel: ${channel}`);
	const handler = (_event: unknown, value: T): void => listener(value);
	ipcRenderer.on(channel, handler);
	return () => {
		ipcRenderer.removeListener(channel, handler);
	};
}

const api: MuApi = {
	app: {
		version: () => invoke<string>(IPC_CHANNELS.appVersion),
		platform: () => invoke<string>(IPC_CHANNELS.appPlatform),
	},
	harness: {
		status: () => invoke<HarnessStatus>(IPC_CHANNELS.harnessStatus),
		onStatus: (listener) => subscribe<HarnessStatus>(IPC_CHANNELS.harnessStatusEvent, listener),
		restart: () => invoke<HarnessStatus>(IPC_CHANNELS.harnessRestart),
		stop: () => invoke<void>(IPC_CHANNELS.harnessStop),
		prompt: (message) => invoke<PromptResult>(IPC_CHANNELS.harnessPrompt, { message }),
		abort: () => invoke<void>(IPC_CHANNELS.harnessAbort),
		snapshot: () => invoke<SessionSnapshot>(IPC_CHANNELS.harnessSnapshot),
		history: () => invoke<readonly HistoryMessage[]>(IPC_CHANNELS.harnessHistory),
		newSession: () => invoke<void>(IPC_CHANNELS.harnessNewSession),
		models: () => invoke<readonly ModelChoice[]>(IPC_CHANNELS.harnessModels),
		setModel: (provider, modelId) => invoke<void>(IPC_CHANNELS.harnessSetModel, { provider, modelId }),
		respond: (answer: UiAnswer) => invoke<void>(IPC_CHANNELS.harnessUiResponse, answer),
		onEvent: (listener) => subscribe<AgentEvent>(IPC_CHANNELS.harnessAgentEvent, listener),
	},
	workspace: {
		current: () => invoke<WorkspaceState>(IPC_CHANNELS.workspaceCurrent),
		choose: () => invoke<WorkspaceChoice>(IPC_CHANNELS.workspaceChoose),
		open: (path) => invoke<WorkspaceChoice>(IPC_CHANNELS.workspaceOpen, { path }),
		readFile: (path) => invoke<FilePreview>(IPC_CHANNELS.workspaceReadFile, { path }),
		saveFile: (path, text, expectedHash) =>
			invoke<SavedFile>(IPC_CHANNELS.workspaceSaveFile, { path, text, expectedHash }),
	},
	sessions: {
		list: () => invoke<readonly SessionSummary[]>(IPC_CHANNELS.sessionsList),
		listAll: () => invoke<readonly SessionSummary[]>(IPC_CHANNELS.sessionsListAll),
		open: (path) => invoke<void>(IPC_CHANNELS.sessionsOpen, { path }),
		openAcross: (path) => invoke<WorkspaceState>(IPC_CHANNELS.sessionsOpenAcross, { path }),
		rename: (name) => invoke<void>(IPC_CHANNELS.sessionsRename, { name }),
	},
	judgments: {
		recent: () => invoke<readonly JudgmentRecord[]>(IPC_CHANNELS.judgmentsRecent),
	},
	update: {
		check: () => invoke<UpdateCheck>(IPC_CHANNELS.updateCheck),
		install: () => invoke<UpdateInstallOutcome>(IPC_CHANNELS.updateInstall),
	},
	settings: {
		snapshot: () => invoke<SettingsSnapshot>(IPC_CHANNELS.settingsSnapshot),
		write: (change: SettingsChange) => invoke<SettingsSnapshot>(IPC_CHANNELS.settingsWrite, change),
	},
	consent: {
		status: () => invoke<ConsentState>(IPC_CHANNELS.consentStatus),
		grant: () => invoke<ConsentState>(IPC_CHANNELS.consentGrant),
		revoke: () => invoke<ConsentState>(IPC_CHANNELS.consentRevoke),
	},
	preview: {
		open: (url) => invoke<void>(IPC_CHANNELS.previewOpen, { url }),
		close: () => invoke<void>(IPC_CHANNELS.previewClose),
	},
};

contextBridge.exposeInMainWorld("mu", api);
