// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The main-process half of the bridge: one function per channel, no channel the page can name.
 *
 * `ipcMain.handle` is registered for exactly the channels in `INVOKE_CHANNELS` (`main/index.ts`), and every one of
 * them lands in `dispatch`. The dispatcher is a plain function of its dependencies, so the allow-list, the payload
 * checks, and the error mapping are all testable without Electron.
 */

import {
	type ApiFailure,
	type ApiResult,
	INVOKE_CHANNELS,
	type InvokeChannel,
	MAX_PROMPT_IMAGES,
	MAX_PROMPT_IMAGE_CHARS,
	PROMPT_IMAGE_TYPES,
	type PromptImage,
	type UiAnswer,
} from "../shared/api.ts";
import type { SettingsChange } from "../shared/settings.ts";
import { FileConflictError } from "./files.ts";
import { NotRunningError } from "./supervisor.ts";

/** What the handlers need. Narrow on purpose: a test passes a few functions, not an app. */
export interface ApiDependencies {
	readonly version: string;
	readonly platform: string;
	readonly supervisor: {
		getStatus(): unknown;
		restart(): Promise<unknown>;
		stop(): Promise<void>;
		prompt(message: string, images: readonly PromptImage[]): Promise<unknown>;
		abort(): Promise<void>;
		snapshot(): Promise<unknown>;
		history(): Promise<unknown>;
		newSession(): Promise<void>;
		models(): Promise<unknown>;
		setModel(provider: string, modelId: string): Promise<void>;
		respond(answer: UiAnswer): void;
	};
	/** The folder the agent runs in; choosing one restarts the supervisor. */
	readonly workspace: {
		current(): Promise<unknown>;
		choose(): Promise<unknown>;
		open(path: string): Promise<unknown>;
		readFile(path: string): Promise<unknown>;
		saveFile(path: string, text: string, expectedHash: string): Promise<unknown>;
		searchFiles(query: string): Promise<unknown>;
	};
	/** Saved sessions for the current workspace. */
	readonly sessions: {
		list(): Promise<unknown>;
		listAll(): Promise<unknown>;
		open(path: string): Promise<void>;
		openAcross(path: string): Promise<unknown>;
		remove(path: string): Promise<unknown>;
		rename(name: string): Promise<void>;
	};
	/** The update feed, read on demand; `install` downloads, proves and starts what it offers. */
	readonly update: {
		check(): Promise<unknown>;
		install(): Promise<unknown>;
	};
	/** The last decisions from mu's ledger, read through the harness's own `ledger --json`. */
	readonly judgments: {
		recent(): Promise<unknown>;
	};
	/** The harness's manifest and the settings in effect; `write` validates against the manifest before saving. */
	readonly settings: {
		snapshot(): Promise<unknown>;
		write(change: SettingsChange): Promise<unknown>;
	};
	readonly consent: {
		status(): Promise<unknown>;
		grant(): Promise<unknown>;
		revoke(): Promise<unknown>;
	};
	readonly preview: {
		open(url: string): Promise<void>;
		close(): Promise<void>;
	};
}

class InvalidPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidPayloadError";
	}
}

/** A prompt longer than this is not a prompt; it is a pasted file. The agent gets one either way, off the bridge. */
const MAX_PROMPT_CHARS = 200_000;

function promptOf(payload: unknown): { message: string; images: readonly PromptImage[] } {
	const message = field(payload, "message");
	if (typeof message !== "string" || message.trim() === "") throw new InvalidPayloadError("a prompt needs a message");
	if (message.length > MAX_PROMPT_CHARS) {
		throw new InvalidPayloadError(`a prompt may be at most ${MAX_PROMPT_CHARS} characters`);
	}
	return { message, images: imagesOf(field(payload, "images")) };
}

/**
 * The images a prompt carries. The renderer already refuses what it cannot read, but this is the boundary: a type the
 * providers accept, base64 data with no `data:` prefix, and a bounded number and size.
 */
function imagesOf(value: unknown): readonly PromptImage[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new InvalidPayloadError("images must be a list");
	if (value.length > MAX_PROMPT_IMAGES) throw new InvalidPayloadError(`a prompt may carry at most ${MAX_PROMPT_IMAGES} images`);
	return value.map((entry) => {
		const mimeType = field(entry, "mimeType");
		const data = field(entry, "data");
		if (typeof mimeType !== "string" || !(PROMPT_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
			throw new InvalidPayloadError(`an image must be one of ${PROMPT_IMAGE_TYPES.join(", ")}`);
		}
		if (typeof data !== "string" || data === "" || data.length > MAX_PROMPT_IMAGE_CHARS) {
			throw new InvalidPayloadError("an image must carry base64 data within the size limit");
		}
		if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) throw new InvalidPayloadError("an image must carry base64 data");
		return { mimeType, data };
	});
}

function urlOf(payload: unknown): string {
	const url = field(payload, "url");
	if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
		throw new InvalidPayloadError("a preview needs an http or https URL");
	}
	return url;
}

/** A change names a feature and an option; whether the value is allowed is the settings layer's question. */
function changeOf(payload: unknown): SettingsChange {
	const feature = field(payload, "feature");
	const option = field(payload, "option");
	if (typeof feature !== "string" || feature === "") throw new InvalidPayloadError("a change needs a feature");
	if (typeof option !== "string" || option === "") throw new InvalidPayloadError("a change needs an option");
	if (!("value" in (payload as Record<string, unknown>))) throw new InvalidPayloadError("a change needs a value");
	return { feature, option, value: field(payload, "value") };
}

function modelOf(payload: unknown): { provider: string; modelId: string } {
	const provider = field(payload, "provider");
	const modelId = field(payload, "modelId");
	if (typeof provider !== "string" || provider === "") throw new InvalidPayloadError("a model needs a provider");
	if (typeof modelId !== "string" || modelId === "") throw new InvalidPayloadError("a model needs an id");
	return { provider, modelId };
}

function sessionPathOf(payload: unknown): string {
	const path = field(payload, "path");
	if (typeof path !== "string" || path.trim() === "") throw new InvalidPayloadError("a session needs a path");
	return path;
}

function workspacePathOf(payload: unknown): string {
	const path = field(payload, "path");
	if (typeof path !== "string" || path.trim() === "") throw new InvalidPayloadError("a workspace needs a path");
	return path;
}

function sessionNameOf(payload: unknown): string {
	const name = field(payload, "name");
	if (typeof name !== "string" || name.trim() === "") throw new InvalidPayloadError("a session name is required");
	return name;
}

function filePathOf(payload: unknown): string {
	const path = field(payload, "path");
	if (typeof path !== "string" || path.trim() === "") throw new InvalidPayloadError("a file preview needs a path");
	return path;
}

/** A textedit over the bridge: within the same 1 MB the reader accepts, and always quoting what it read. */
const MAX_FILE_CHARS = 2_000_000;

function fileEditOf(payload: unknown): { path: string; text: string; expectedHash: string } {
	const path = filePathOf(payload);
	const text = field(payload, "text");
	const expectedHash = field(payload, "expectedHash");
	if (typeof text !== "string") throw new InvalidPayloadError("a save needs the file's text");
	if (text.length > MAX_FILE_CHARS) throw new InvalidPayloadError(`a save may be at most ${MAX_FILE_CHARS} characters`);
	if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash)) {
		throw new InvalidPayloadError("a save needs the hash of the file it read");
	}
	return { path, text, expectedHash };
}

/** A query, not a pattern: no path, no glob, nothing that could name a folder outside the project. */
function searchQueryOf(payload: unknown): string {
	const query = field(payload, "query");
	if (typeof query !== "string") throw new InvalidPayloadError("a file search needs a query");
	if (query.length > 200) throw new InvalidPayloadError("a file search query may be at most 200 characters");
	return query;
}

/** An answer: exactly one of a value, a confirmation, or a cancellation, and always an id. */
function answerOf(payload: unknown): UiAnswer {
	const id = field(payload, "id");
	if (typeof id !== "string" || id === "") throw new InvalidPayloadError("an answer needs the id of the request");
	const value = field(payload, "value");
	const confirmed = field(payload, "confirmed");
	const cancelled = field(payload, "cancelled");
	if (cancelled === true) return { id, cancelled: true };
	if (typeof confirmed === "boolean") return { id, confirmed };
	if (typeof value === "string") return { id, value };
	throw new InvalidPayloadError("an answer needs a value, a confirmation or a cancellation");
}

function field(payload: unknown, name: string): unknown {
	if (typeof payload !== "object" || payload === null) return undefined;
	return (payload as Record<string, unknown>)[name];
}

function failure(code: ApiFailure["code"], message: string): ApiResult<never> {
	return { ok: false, error: { code, message } };
}

export interface Api {
	readonly channels: typeof INVOKE_CHANNELS;
	dispatch(channel: string, payload: unknown): Promise<ApiResult<unknown>>;
}

export function createApi(deps: ApiDependencies): Api {
	const handlers: Record<InvokeChannel, (payload: unknown) => Promise<unknown>> = {
		"app:version": async () => deps.version,
		"app:platform": async () => deps.platform,
		"harness:status": async () => deps.supervisor.getStatus(),
		"harness:restart": async () => deps.supervisor.restart(),
		"harness:stop": async () => {
			await deps.supervisor.stop();
			return deps.supervisor.getStatus();
		},
		"harness:prompt": async (payload) => {
			const prompt = promptOf(payload);
			return deps.supervisor.prompt(prompt.message, prompt.images);
		},
		"harness:abort": async () => {
			await deps.supervisor.abort();
			return undefined;
		},
		"harness:snapshot": async () => deps.supervisor.snapshot(),
		"harness:history": async () => deps.supervisor.history(),
		"harness:new-session": async () => {
			await deps.supervisor.newSession();
			return undefined;
		},
		"harness:models": async () => deps.supervisor.models(),
		"harness:set-model": async (payload) => {
			const model = modelOf(payload);
			await deps.supervisor.setModel(model.provider, model.modelId);
			return undefined;
		},
		"harness:ui-response": async (payload) => {
			deps.supervisor.respond(answerOf(payload));
			return undefined;
		},
		"workspace:current": async () => deps.workspace.current(),
		"workspace:choose": async () => deps.workspace.choose(),
		"workspace:open": async (payload) => deps.workspace.open(workspacePathOf(payload)),
		"workspace:read-file": async (payload) => deps.workspace.readFile(filePathOf(payload)),
		"workspace:write-file": async (payload) => {
			const edit = fileEditOf(payload);
			return deps.workspace.saveFile(edit.path, edit.text, edit.expectedHash);
		},
		"workspace:search-files": async (payload) => deps.workspace.searchFiles(searchQueryOf(payload)),
		"sessions:list": async () => deps.sessions.list(),
		"sessions:list-all": async () => deps.sessions.listAll(),
		"sessions:open": async (payload) => {
			await deps.sessions.open(sessionPathOf(payload));
			return undefined;
		},
		"sessions:open-across": async (payload) => deps.sessions.openAcross(sessionPathOf(payload)),
		"sessions:remove": async (payload) => deps.sessions.remove(sessionPathOf(payload)),
		"sessions:rename": async (payload) => {
			await deps.sessions.rename(sessionNameOf(payload));
			return undefined;
		},
		"judgments:recent": async () => deps.judgments.recent(),
		"update:check": async () => deps.update.check(),
		"update:install": async () => deps.update.install(),
		"settings:snapshot": async () => deps.settings.snapshot(),
		"settings:write": async (payload) => deps.settings.write(changeOf(payload)),
		"consent:status": async () => deps.consent.status(),
		"consent:grant": async () => deps.consent.grant(),
		"consent:revoke": async () => deps.consent.revoke(),
		"preview:open": async (payload) => {
			await deps.preview.open(urlOf(payload));
			return undefined;
		},
		"preview:close": async () => {
			await deps.preview.close();
			return undefined;
		},
	};

	return {
		channels: INVOKE_CHANNELS,
		async dispatch(channel: string, payload: unknown): Promise<ApiResult<unknown>> {
			if (!(INVOKE_CHANNELS as readonly string[]).includes(channel)) {
				return failure("unknown-channel", `there is no handler for ${channel}`);
			}
			const handler = handlers[channel as InvokeChannel];
			try {
				return { ok: true, value: await handler(payload) };
			} catch (error) {
				if (error instanceof InvalidPayloadError) return failure("invalid-payload", error.message);
				if (error instanceof NotRunningError) return failure("not-running", error.message);
				if (error instanceof FileConflictError) return failure("conflict", error.message);
				return failure("failed", error instanceof Error ? error.message : String(error));
			}
		},
	};
}
