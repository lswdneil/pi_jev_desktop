// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import {
	type PendingApproval,
	MAX_TOOL_OUTPUT,
	toolResultText,
	waitingTitle,
	type ConversationEvent,
	type ConversationState,
	initialConversation,
	recordDecision,
	reduceAll,
	reduceConversation,
	seedConversation,
	visibleMessages,
} from "../../src/shared/conversation.ts";

/**
 * The reducer, event by event. These are the shapes the harness actually sends (`JsonAgentSessionEvent`), including the
 * ones the shell only passes through, so a renamed field fails here instead of blanking a conversation.
 */

function fold(events: ConversationEvent[], start: ConversationState = initialConversation()): ConversationState {
	return reduceAll(start, events);
}

const assistantMessage = { role: "assistant", content: [{ type: "text", text: "" }] };

function textDelta(delta: string): ConversationEvent {
	return {
		type: "message_update",
		usage: {},
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
	} as unknown as ConversationEvent;
}

describe("turns and messages", () => {
	it("collects a streamed answer into one message", () => {
		const state = fold([
			{ type: "agent_start" } as ConversationEvent,
			{ type: "turn_start" } as ConversationEvent,
			{ type: "message_start", message: assistantMessage } as unknown as ConversationEvent,
			textDelta("Hel"),
			textDelta("lo"),
			{ type: "message_end", message: { ...assistantMessage, content: [{ type: "text", text: "Hello" }] } } as unknown as ConversationEvent,
		]);

		expect(state.running).toBe(true);
		expect(state.streaming).toBeUndefined();
		expect(state.messages.map((message) => message.text)).toEqual(["Hello"]);
		expect(state.board.turn).toBe(1);
	});

	it("shows the text as it arrives, without waiting for the end", () => {
		const state = fold([
			{ type: "turn_start" } as ConversationEvent,
			{ type: "message_start", message: assistantMessage } as unknown as ConversationEvent,
			textDelta("partial"),
		]);

		expect(state.streaming?.text).toBe("partial");
		expect(state.messages[0]?.text).toBe("partial");
	});

	it("keeps a user message and a tool result apart from the assistant's", () => {
		const state = fold([
			{ type: "message_start", message: { role: "user", content: "do it" } } as unknown as ConversationEvent,
			{ type: "message_start", message: { role: "user", content: "again" } } as unknown as ConversationEvent,
		]);
		expect(state.messages.map((message) => `${message.role}:${message.text}`)).toEqual(["user:do it", "user:again"]);
	});

	it("shows a prompt once when the harness announces both its start and its end", () => {
		const state = fold([
			{ type: "message_start", message: { role: "user", content: "do it" } } as unknown as ConversationEvent,
			{ type: "message_end", message: { role: "user", content: "do it" } } as unknown as ConversationEvent,
		]);
		// The real harness sends both events for one prompt; a row each would show every message the user typed twice.
		expect(state.messages.map((message) => `${message.role}:${message.text}`)).toEqual(["user:do it"]);
		expect(state.pendingUser).toBeUndefined();
	});

	it("still shows a prompt that arrives as its end alone", () => {
		const state = fold([{ type: "message_end", message: { role: "user", content: "only the end" } } as unknown as ConversationEvent]);
		expect(state.messages.map((message) => `${message.role}:${message.text}`)).toEqual(["user:only the end"]);
	});

	it("gives the next prompt its own row after the first one ended", () => {
		const state = fold([
			{ type: "message_start", message: { role: "user", content: "first" } } as unknown as ConversationEvent,
			{ type: "message_end", message: { role: "user", content: "first" } } as unknown as ConversationEvent,
			{ type: "message_start", message: { role: "user", content: "second" } } as unknown as ConversationEvent,
			{ type: "message_end", message: { role: "user", content: "second" } } as unknown as ConversationEvent,
		]);
		expect(state.messages.map((message) => message.text)).toEqual(["first", "second"]);
	});

	it("shows the provider's failure once, not an empty answer and not one row per retry", () => {
		const failed = {
			role: "assistant",
			content: [{ type: "text", text: "" }],
			stopReason: "error",
			errorMessage: "the provider is having a bad day",
		};
		const state = fold([
			{ type: "message_start", message: failed } as unknown as ConversationEvent,
			{ type: "message_end", message: failed } as unknown as ConversationEvent,
			{ type: "message_start", message: failed } as unknown as ConversationEvent,
			{ type: "message_end", message: failed } as unknown as ConversationEvent,
		]);
		expect(state.messages.map((message) => message.text)).toEqual(["the provider is having a bad day"]);
		expect(visibleMessages(state).map((message) => message.text)).toEqual(["the provider is having a bad day"]);
	});

	it("folds repeated failures that each announce an empty start", () => {
		// A retry announces the failure message before it has any text, so the previous row is an empty start; the row
		// that must be compared with is the last one that says something.
		const failed = { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "terminated" };
		const state = fold([
			{ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "" }] } } as unknown as ConversationEvent,
			{ type: "message_start", message: failed } as unknown as ConversationEvent,
			{ type: "message_end", message: failed } as unknown as ConversationEvent,
			{ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "" }] } } as unknown as ConversationEvent,
			{ type: "message_start", message: failed } as unknown as ConversationEvent,
			{ type: "message_end", message: failed } as unknown as ConversationEvent,
		]);
		expect(visibleMessages(state).map((message) => message.text)).toEqual(["terminated"]);
	});

	it("does not mount a blank assistant row", () => {
		const stopped = { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "aborted" };
		const state = fold([
			{ type: "message_start", message: { role: "user", content: "do it" } } as unknown as ConversationEvent,
			{ type: "message_end", message: { role: "user", content: "do it" } } as unknown as ConversationEvent,
			{ type: "message_start", message: stopped } as unknown as ConversationEvent,
			{ type: "message_end", message: stopped } as unknown as ConversationEvent,
		]);
		expect(state.messages.length).toBe(2);
		expect(visibleMessages(state).map((message) => message.text)).toEqual(["do it"]);
	});

	it("shows a tool call once, from its execution events, not once per message event", () => {
		const toolResult = { role: "toolResult", content: [{ type: "text", text: "hello-from-tool" }] };
		const state = fold([
			{ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "echo hello-from-tool" } } as unknown as ConversationEvent,
			{ type: "tool_execution_end", toolCallId: "call-1", isError: false } as unknown as ConversationEvent,
			// The real harness also announces the result as a message; that used to be two more rows with raw output.
			{ type: "message_start", message: toolResult } as unknown as ConversationEvent,
			{ type: "message_end", message: toolResult } as unknown as ConversationEvent,
		]);
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]?.tool?.name).toBe("bash");
		expect(state.messages[0]?.tool?.status).toBe("ok");
	});

	it("stops: agent_end clears the stream and says so", () => {
		const state = fold([
			{ type: "turn_start" } as ConversationEvent,
			{ type: "message_start", message: assistantMessage } as unknown as ConversationEvent,
			textDelta("half"),
			{ type: "agent_end", messages: [], willRetry: false } as unknown as ConversationEvent,
		]);
		expect(state.running).toBe(false);
		expect(state.streaming).toBeUndefined();
		expect(state.board.current).toBeUndefined();
		expect(state.board.steps).toContain("turn finished");
	});
});

describe("tools", () => {
	it("adds a row per tool call and records the file it touched", () => {
		const state = fold([
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "write",
				args: { path: "src/app.ts", content: "..." },
			} as unknown as ConversationEvent,
		]);

		expect(state.messages[0]?.tool).toMatchObject({ id: "call-1", name: "write", summary: "src/app.ts", status: "running" });
		expect(state.files).toEqual([{ path: "src/app.ts", tool: "write", at: expect.any(Number) }]);
		expect(state.board.current).toBe("write: src/app.ts");
		expect(state.board.steps.at(-1)).toBe("write: src/app.ts");
	});

	it("marks the row done or failed when the tool ends", () => {
		const state = fold([
			{ type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: { command: "ls" } } as unknown as ConversationEvent,
			{ type: "tool_execution_end", toolCallId: "a", result: {}, isError: false } as unknown as ConversationEvent,
			{ type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: { command: "false" } } as unknown as ConversationEvent,
			{ type: "tool_execution_end", toolCallId: "b", result: {}, isError: true } as unknown as ConversationEvent,
		]);

		expect(state.messages.map((message) => message.tool?.status)).toEqual(["ok", "error"]);
	});

	it("keeps the file list bounded", () => {
		const events = Array.from({ length: 250 }, (_, index) => ({
			type: "tool_execution_start",
			toolCallId: `call-${index}`,
			toolName: "write",
			args: { path: `file-${index}.ts` },
		})) as unknown as ConversationEvent[];

		const state = fold(events);
		expect(state.files.slice(-1)[0]?.path).toBe("file-249.ts");
		expect(state.files.length).toBeLessThanOrEqual(200);
		expect(state.messages.length).toBe(250);
	});
});

describe("approvals", () => {
	it("turns a confirm request into a pending question and says the agent is waiting", () => {
		const state = fold([
			{
				type: "extension_ui_request",
				id: "ui-1",
				method: "confirm",
				title: "Run rm -rf build?",
				message: "This deletes the build folder.",
			} as unknown as ConversationEvent,
		]);

		expect(state.approval).toMatchObject({ id: "ui-1", method: "confirm", title: "Run rm -rf build?", message: "This deletes the build folder." });
		expect(state.board.current).toBe("waiting: Run rm -rf build?");
	});

	it("carries a select's options and an input's placeholder", () => {
		const selected = reduceConversation(initialConversation(), {
			type: "extension_ui_request",
			id: "ui-2",
			method: "select",
			title: "Which branch?",
			options: ["main", "dev"],
		} as unknown as ConversationEvent);
		expect(selected.approval?.options).toEqual(["main", "dev"]);

		const asked = reduceConversation(initialConversation(), {
			type: "extension_ui_request",
			id: "ui-3",
			method: "input",
			title: "Ticket number",
			placeholder: "ABC-123",
		} as unknown as ConversationEvent);
		expect(asked.approval?.placeholder).toBe("ABC-123");
	});

	it("display-only requests do not become questions", () => {
		for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]) {
			const state = reduceConversation(initialConversation(), {
				type: "extension_ui_request",
				id: "ui-x",
				method,
				title: "noise",
			} as unknown as ConversationEvent);
			expect(state.approval).toBeUndefined();
		}
	});
});

describe("a session that already exists", () => {
	it("shows the messages the harness has, above anything new", () => {
		const state = seedConversation(initialConversation(), [
			{ role: "user", text: "earlier question" },
			{ role: "assistant", text: "earlier answer" },
		]);
		expect(state.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
			"user:earlier question",
			"assistant:earlier answer",
		]);
	});

	it("keeps rows without text out, and is idempotent", () => {
		const seeded = seedConversation(initialConversation(), [
			{ role: "user", text: "  " },
			{ role: "assistant", text: "kept" },
		]);
		expect(seeded.messages).toHaveLength(1);
		expect(seedConversation(seeded, [{ role: "assistant", text: "kept" }])).toBe(seeded);
	});

	it("then a live message arrives after the history", () => {
		const seeded = seedConversation(initialConversation(), [{ role: "user", text: "earlier" }]);
		const live = reduceConversation(seeded, {
			type: "message_start",
			message: { role: "user", content: "now" },
		} as unknown as ConversationEvent);
		expect(live.messages.map((message) => message.text)).toEqual(["earlier", "now"]);
	});

	it("does not add the history again when the screen is entered a second time", () => {
		// Leaving the conversation for the settings and coming back asks for the history again; what is already on
		// screen must not appear twice (the live rows carry event ids, not `history-*` ids).
		const history = [
			{ role: "user" as const, text: "earlier question" },
			{ role: "assistant" as const, text: "earlier answer" },
		];
		const seeded = seedConversation(initialConversation(), history);
		const live = reduceConversation(seeded, {
			type: "message_start",
			message: { role: "user", content: "next" },
		} as unknown as ConversationEvent);
		const again = seedConversation(live, [...history, { role: "user", text: "next" }]);
		expect(again.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
			"user:earlier question",
			"assistant:earlier answer",
			"user:next",
		]);
	});
});

describe("a long conversation", () => {
	it("mounts only the newest window of rows", () => {
		const messages = Array.from({ length: 250 }, (_, index) => ({
			id: `m-${index}`,
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			text: `message ${index + 1}`,
		}));
		const state = { ...initialConversation(), messages };
		const visible = visibleMessages(state);
		expect(visible).toHaveLength(200);
		expect(visible[0]?.text).toBe("message 51");
		expect(visible[visible.length - 1]?.text).toBe("message 250");
		// An explicit limit wins, and zero mounts nothing.
		expect(visibleMessages(state, 10).map((message) => message.text)).toEqual(
			Array.from({ length: 10 }, (_, index) => `message ${241 + index}`),
		);
		expect(visibleMessages(state, 0)).toHaveLength(0);
	});
});

describe("the protocol growing", () => {
	it("ignores an event type this build has never heard of", () => {
		const before = initialConversation();
		const after = reduceConversation(before, { type: "brand_new_event", detail: 1 } as unknown as ConversationEvent);
		expect(after).toBe(before);
	});

	it("counts a queue update without touching the messages", () => {
		const state = reduceConversation(initialConversation(), {
			type: "queue_update",
			steering: ["a"],
			followUp: ["b", "c"],
		} as unknown as ConversationEvent);
		expect(state.queue).toEqual({ steering: 1, followUp: 2 });
		expect(state.messages).toEqual([]);
	});

	it("keeps a coded notice as an event, so a language switch can re-render it", () => {
		const state = reduceConversation(initialConversation(), {
			type: "extension_ui_request",
			id: "notice-1",
			method: "notify",
			code: "browser.run.open_failed",
			reason: "could not open {url}",
			params: { url: "https://x.test" },
			message: "not shown",
		} as unknown as ConversationEvent);

		expect(state.notices).toHaveLength(1);
		expect(state.notices[0]?.event.code).toBe("browser.run.open_failed");
		expect(state.notices[0]?.event.params).toEqual({ url: "https://x.test" });
		// A notice with a code is a line, not a question.
		expect(state.approval).toBeUndefined();
	});

	it("keeps the question and the answer the harness does not store", () => {
		const approval: PendingApproval = {
			id: "ui-danger",
			method: "confirm",
			title: "Run rm -rf build?",
			message: "This deletes the build folder.",
			options: undefined,
			placeholder: undefined,
		};

		const answered = recordDecision(initialConversation(), approval, "denied", 1_700_000_000_000);

		expect(answered.decisions).toEqual([
			{
				id: "ui-danger",
				title: "Run rm -rf build?",
				method: "confirm",
				message: "This deletes the build folder.",
				answer: "denied",
				at: 1_700_000_000_000,
			},
		]);
		expect(answered.revision).toBe(1);
	});

	it("keeps the newest decisions when the log is full", () => {
		const approval: PendingApproval = {
			id: "ui",
			method: "input",
			title: "Which branch?",
			message: undefined,
			options: undefined,
			placeholder: "main",
		};
		let state = initialConversation();
		for (let index = 0; index < 60; index++) {
			state = recordDecision(state, { ...approval, id: `ui-${index}` }, "main", index);
		}
		expect(state.decisions).toHaveLength(50);
		expect(state.decisions[0]?.id).toBe("ui-10");
		expect(state.decisions.at(-1)?.id).toBe("ui-59");
	});

	it("reads the waiting line back into the question it was made from", () => {
		expect(waitingTitle("waiting: Run rm -rf build?")).toBe("Run rm -rf build?");
		expect(waitingTitle("thinking")).toBeUndefined();
		expect(waitingTitle(undefined)).toBeUndefined();
	});

	it("reads a tool's answer in the shapes a harness sends it", () => {
		expect(toolResultText("plain")).toBe("plain");
		expect(toolResultText({ content: [{ type: "text", text: "ok" }] })).toBe("ok");
		expect(toolResultText({ output: "ls: no such file" })).toBe("ls: no such file");
		expect(toolResultText({ stdout: "built", stderr: "warning" })).toBe("built\nwarning");
		expect(toolResultText({})).toBeUndefined();
		expect(toolResultText(undefined)).toBeUndefined();
		expect(toolResultText({ content: [] })).toBeUndefined();
	});

	it("clips a tool's answer to something a panel can show", () => {
		const clipped = toolResultText("x".repeat(MAX_TOOL_OUTPUT + 100));
		expect(clipped).toHaveLength(MAX_TOOL_OUTPUT + 2);
		expect(clipped?.endsWith("…")).toBe(true);
	});
});
