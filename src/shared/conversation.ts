// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The conversation, folded from the harness's event stream.
 *
 * This is a plain function of (state, event) — no hooks, no components, no Electron — because that is the part worth
 * testing and the part the old shell lost inside a 2,209-line `SendBox`. The component subscribes and renders; it does
 * not interpret events.
 *
 * The event shapes are pi's (`JsonAgentSessionEvent`, `RpcExtensionUIRequest`), imported as types only, so a rename
 * upstream fails `tsc` here rather than showing an empty window at runtime.
 */

import type { JsonAgentSessionEvent, RpcExtensionUIRequest, RpcExtensionUIResponse } from "./pi-protocol.ts";
import type { PresentationEvent } from "./presentation.ts";

/** What the renderer can receive: the session's events plus the UI requests and answers the protocol shares the stream with. */
export type ConversationEvent = JsonAgentSessionEvent | RpcExtensionUIRequest | RpcExtensionUIResponse;

export interface ChatTool {
	readonly id: string;
	readonly name: string;
	/** A one-line summary of the arguments: a path, a command, the first line of a patch. */
	readonly summary: string;
	readonly status: "running" | "ok" | "error";
}

export interface ChatMessage {
	readonly id: string;
	readonly role: "user" | "assistant" | "tool";
	readonly text: string;
	readonly tool?: ChatTool;
	/** The row is the harness's account of a failed run, not something a model said. */
	readonly failure?: true;
}

/** A question the harness is blocked on. Until it is answered, the run waits. */
export interface PendingApproval {
	readonly id: string;
	readonly method: "confirm" | "select" | "input" | "editor";
	readonly title: string;
	readonly message: string | undefined;
	readonly options: readonly string[] | undefined;
	readonly placeholder: string | undefined;
}

export interface ChangedFile {
	readonly path: string;
	readonly tool: string;
	readonly at: number;
}

export interface BoardState {
	readonly turn: number;
	/** What the agent is doing right now, in one line: the running tool, or "thinking". */
	readonly current: string | undefined;
	/** The last few actions, newest last. */
	readonly steps: readonly string[];
}

export interface ConversationState {
	readonly messages: readonly ChatMessage[];
	/** The assistant message being written, kept apart so a delta does not copy the message list. */
	readonly streaming: { readonly id: string; readonly text: string } | undefined;
	readonly approval: PendingApproval | undefined;
	readonly running: boolean;
	readonly queue: { readonly steering: number; readonly followUp: number };
	readonly files: readonly ChangedFile[];
	readonly board: BoardState;
	/**
	 * Lines the harness said that are not conversation: a notice, a status. They carry a presentation code, which the
	 * screen translates (`shared/presentation.ts`); keeping the event rather than a string is what lets a language
	 * switch re-render them.
	 */
	readonly notices: readonly { readonly id: string; readonly event: PresentationEvent }[];
	/**
	 * The user message that started and has not ended yet. The harness sends `message_start` and `message_end` for a
	 * prompt, and a row for each would show every prompt twice; the id written at the start is the one the end updates.
	 */
	readonly pendingUser: { readonly id: string } | undefined;
	/** Bumped on every change, so a subscriber can tell "nothing new" from "same shape, new text". */
	readonly revision: number;
}

const MAX_STEPS = 40;
const MAX_FILES = 200;
const MAX_NOTICES = 30;

/** How many messages stay mounted. Older ones are history the panels summarise, not rows to scroll through. */
export const VISIBLE_MESSAGES = 200;

/**
 * The rows the window mounts: the newest `limit`, never all of a long session. A conversation of two thousand messages
 * then costs the same as one of two hundred, which is the property the view needs and the reducer cannot enforce.
 */
export function visibleMessages(state: ConversationState, limit: number = VISIBLE_MESSAGES): readonly ChatMessage[] {
	if (limit <= 0) return [];
	// A row with neither text nor a tool is not something to show: the harness writes such a message when a run is
	// stopped before it says anything, and a blank assistant row reads as an empty answer.
	const rows = state.messages.filter((message) => message.tool !== undefined || message.text.trim() !== "");
	return rows.length <= limit ? rows : rows.slice(-limit);
}

export function initialConversation(): ConversationState {
	return {
		messages: [],
		streaming: undefined,
		approval: undefined,
		running: false,
		queue: { steering: 0, followUp: 0 },
		files: [],
		board: { turn: 0, current: undefined, steps: [] },
		notices: [],
		pendingUser: undefined,
		revision: 0,
	};
}

/** The text of an agent message, joined from its text blocks. Tool calls are shown as their own rows. */
export function messageText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (typeof block === "object" && block !== null) {
				const typed = block as { type?: unknown; text?: unknown };
				if (typed.type === "text" && typeof typed.text === "string") return typed.text;
			}
			return "";
		})
		.filter((part) => part !== "")
		.join("\n\n");
}

function roleOf(message: unknown): ChatMessage["role"] | undefined {
	if (typeof message !== "object" || message === null) return undefined;
	const role = (message as { role?: unknown }).role;
	if (role === "user" || role === "assistant" || role === "toolResult") return role === "toolResult" ? "tool" : role;
	return undefined;
}

/**
 * What an assistant message says when the run failed before writing anything: the harness sets `stopReason: "error"`
 * and puts the reason in `errorMessage`, with empty content. Showing that row as empty is the worst option — the person
 * sees a reply that says nothing instead of the provider's error.
 */
function failureText(message: unknown): string | undefined {
	if (typeof message !== "object" || message === null) return undefined;
	const record = message as { stopReason?: unknown; errorMessage?: unknown };
	if (record.stopReason !== "error") return undefined;
	return typeof record.errorMessage === "string" && record.errorMessage.trim() !== "" ? record.errorMessage : undefined;
}

/** A path or command from a tool's arguments, for the row's one-line summary. */
function summarizeArguments(args: unknown): string {
	if (typeof args !== "object" || args === null) return "";
	const record = args as Record<string, unknown>;
	for (const key of ["path", "file_path", "command", "pattern", "url", "query"]) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value.length > 120 ? `${value.slice(0, 117)}...` : value;
	}
	const first = Object.values(record).find((value) => typeof value === "string");
	return typeof first === "string" ? (first.length > 120 ? `${first.slice(0, 117)}...` : first) : "";
}

function fileOfArgs(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["path", "file_path"]) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return undefined;
}

function remember<T>(list: readonly T[], item: T, capacity: number): readonly T[] {
	const next = [...list, item];
	return next.length > capacity ? next.slice(-capacity) : next;
}

/** The visible message list with the newest change applied. */
function withMessage(state: ConversationState, message: ChatMessage): ConversationState {
	const messages = state.messages.some((existing) => existing.id === message.id)
		? state.messages.map((existing) => (existing.id === message.id ? message : existing))
		: [...state.messages, message];
	return { ...state, messages };
}

/**
 * One event, one state. Unknown event types return the same state: the protocol grows, and an event this build does
 * not know must not break the window.
 */
export function reduceConversation(state: ConversationState, event: ConversationEvent): ConversationState {
	const type = (event as { type?: string }).type;

	switch (type) {
		case "agent_start":
			return bump(state, { ...state, running: true, board: { ...state.board, current: "thinking" } });
		case "agent_end":
			return bump(state, {
				...state,
				running: false,
				streaming: undefined,
				pendingUser: undefined,
				board: { ...state.board, current: undefined, steps: remember(state.board.steps, "turn finished", MAX_STEPS) },
			});
		case "agent_settled":
			return bump(state, { ...state, running: false, pendingUser: undefined, board: { ...state.board, current: undefined } });

		case "turn_start":
			return bump(state, {
				...state,
				running: true,
				pendingUser: undefined,
				board: { turn: state.board.turn + 1, current: "thinking", steps: state.board.steps },
			});
		case "turn_end":
			return bump(state, { ...state, board: { ...state.board, current: undefined } });

		case "message_start": {
			const message = (event as { message?: unknown }).message;
			const role = roleOf(message);
			if (role === undefined) return state;
			// A tool result also arrives as a message, and `tool_execution_start`/`_end` already give it a row: a row per
			// event showed one command three times, twice with the raw output as its text.
			if (role === "tool") return state;
			const text = messageText(message);
			const id = `message-${state.messages.length}-${state.board.turn}`;
			if (role === "assistant") {
				// A failed run announces the same failure message at its start, with no text yet; the row belongs to the
				// end, where the reason is known (and where a retry's identical failure can be folded into one row).
				if (failureText(message) !== undefined) return bump(state, { ...state, streaming: undefined });
				return bump(state, { ...withMessage(state, { id, role, text }), streaming: { id, text } });
			}
			return bump(state, { ...withMessage(state, { id, role, text }), pendingUser: role === "user" ? { id } : state.pendingUser });
		}

		case "message_update": {
			const update = (event as { assistantMessageEvent?: { type?: string; delta?: unknown } }).assistantMessageEvent;
			if (update?.type !== "text_delta" || typeof update.delta !== "string") return state;
			if (state.streaming === undefined) return state;
			const streaming = { id: state.streaming.id, text: state.streaming.text + update.delta };
			const messages = state.messages.map((message) =>
				message.id === streaming.id ? { ...message, text: streaming.text } : message,
			);
			return bump(state, { ...state, streaming, messages });
		}

		case "message_end": {
			const message = (event as { message?: unknown }).message;
			const role = roleOf(message);
			if (role === undefined) return state;
			// See `message_start`: the tool row is the one `tool_execution_*` made.
			if (role === "tool") return state;
			const text = messageText(message);
			if (role === "assistant") {
				const id = state.streaming?.id ?? `message-${state.messages.length}-${state.board.turn}`;
				const failure = failureText(message);
				if (failure !== undefined) {
					// The harness retries a failed provider call; four identical reasons are one story, not four rows.
					// The row to compare with is the last one that says something: each retry also announces an empty
					// start, and those are not what the person saw.
					const previous = [...state.messages].reverse().find((message) => message.text.trim() !== "");
					if (previous?.failure === true && previous.text === failure) return bump(state, { ...state, streaming: undefined });
					return bump(state, { ...withMessage(state, { id, role, text: failure, failure: true }), streaming: undefined });
				}
				const written = text === "" ? (state.streaming?.text ?? "") : text;
				return bump(state, { ...withMessage(state, { id, role, text: written }), streaming: undefined });
			}
			// The end of a prompt the harness already announced is the same row, not a second one; without the start
			// (a harness that only sends ends) it is a row of its own.
			if (state.pendingUser !== undefined) {
				return bump(state, { ...withMessage(state, { id: state.pendingUser.id, role, text }), pendingUser: undefined });
			}
			const id = `message-${state.messages.length}-${state.board.turn}`;
			return bump(state, withMessage(state, { id, role, text }));
		}

		case "tool_execution_start": {
			const started = event as { toolCallId?: unknown; toolName?: unknown; args?: unknown };
			const id = typeof started.toolCallId === "string" ? started.toolCallId : `tool-${state.messages.length}`;
			const name = typeof started.toolName === "string" ? started.toolName : "tool";
			const summary = summarizeArguments(started.args);
			const path = fileOfArgs(started.args);
			const files =
				path === undefined ? state.files : remember(state.files, { path, tool: name, at: Date.now() }, MAX_FILES);
			return bump(state, {
				...withMessage(state, { id, role: "tool", text: "", tool: { id, name, summary, status: "running" } }),
				files,
				board: {
					...state.board,
					current: summary === "" ? name : `${name}: ${summary}`,
					steps: remember(state.board.steps, summary === "" ? name : `${name}: ${summary}`, MAX_STEPS),
				},
			});
		}

		case "tool_execution_end": {
			const ended = event as { toolCallId?: unknown; isError?: unknown };
			const id = typeof ended.toolCallId === "string" ? ended.toolCallId : "";
			const status: ChatTool["status"] = ended.isError === true ? "error" : "ok";
			const messages = state.messages.map((message) =>
				message.id === id && message.tool !== undefined ? { ...message, tool: { ...message.tool, status } } : message,
			);
			return bump(state, { ...state, messages, board: { ...state.board, current: "thinking" } });
		}

		case "extension_ui_request": {
			const request = event as RpcExtensionUIRequest;
			const code = (request as { code?: unknown }).code;
			// Anything carrying a presentation code is a line to show, translated by code; a question is not one — it
			// gets a card and blocks the run.
			if (typeof code === "string") {
				const notice = { id: `notice-${state.notices.length}`, event: request as PresentationEvent };
				return bump(state, { ...state, notices: remember(state.notices, notice, MAX_NOTICES) });
			}
			const method = request.method;
			if (method !== "confirm" && method !== "select" && method !== "input" && method !== "editor") return state;
			const pending: PendingApproval = {
				id: request.id,
				method,
				title: request.title,
				message: "message" in request ? request.message : undefined,
				options: "options" in request ? request.options : undefined,
				placeholder: "placeholder" in request ? request.placeholder : undefined,
			};
			return bump(state, { ...state, approval: pending, board: { ...state.board, current: `waiting: ${request.title}` } });
		}

		case "extension_ui_response":
			// Answered elsewhere (the answer travels out, not in) — but a stray one must not stay on screen.
			return bump(state, { ...state, approval: undefined });

		case "queue_update": {
			const queued = event as { steering?: unknown; followUp?: unknown };
			return bump(state, {
				...state,
				queue: {
					steering: Array.isArray(queued.steering) ? queued.steering.length : 0,
					followUp: Array.isArray(queued.followUp) ? queued.followUp.length : 0,
				},
			});
		}

		default:
			return state;
	}
}

function bump(state: ConversationState, next: Omit<ConversationState, "revision">): ConversationState {
	return { ...next, revision: state.revision + 1 };
}

/** Fold a batch, which is what a subscriber replaying buffered events wants. */
export function reduceAll(state: ConversationState, events: readonly ConversationEvent[]): ConversationState {
	return events.reduce(reduceConversation, state);
}

/** A message the harness already has, as the conversation shows it. */
export interface HistoryMessage {
	readonly role: "user" | "assistant";
	readonly text: string;
}

/**
 * The session's existing messages, for the window that was just opened.
 *
 * A chat that forgets the conversation every time the window opens is not a chat: the harness keeps the session, and
 * this seeds the reducer with what it already has. Messages with no text (a recorded tool call, an empty assistant
 * turn) are skipped — they have no row of their own in this view.
 */
export function seedConversation(state: ConversationState, messages: readonly HistoryMessage[]): ConversationState {
	const rows = messages
		.filter((message) => message.text.trim() !== "")
		.map((message, index) => ({ id: `history-${index}`, role: message.role, text: message.text }));
	if (rows.length === 0) return state;
	const existing = new Set(state.messages.map((message) => message.id));
	const fresh = rows.filter((row) => !existing.has(row.id));
	// A screen that is left and entered again asks for the history again; what is already on screen (with whatever ids
	// the live events gave it) must not be added a second time. Compare by role and text, counting each occurrence.
	const remaining = new Map<string, number>();
	for (const message of state.messages) {
		const key = `${message.role}\u0000${message.text}`;
		remaining.set(key, (remaining.get(key) ?? 0) + 1);
	}
	const missing = fresh.filter((row) => {
		const key = `${row.role}\u0000${row.text}`;
		const count = remaining.get(key) ?? 0;
		if (count === 0) return true;
		remaining.set(key, count - 1);
		return false;
	});
	if (missing.length === 0) return state;
	return {
		...state,
		messages: [...missing.map((row) => ({ id: row.id, role: row.role, text: row.text })), ...state.messages],
		revision: state.revision + 1,
	};
}
