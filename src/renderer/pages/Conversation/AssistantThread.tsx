// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * The conversation transcript on assistant-ui's runtime and viewport.
 *
 * The store still owns the semantics (event folding, visible window, tool rows); this component only converts the
 * snapshot into assistant-ui messages and renders them. Keeping the adapter here is the point of the spike: if the
 * event model changes, the store and reducer stay untouched.
 */

import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
	useThreadMessages,
} from "@assistant-ui/core/react";
import type { MessageState, ThreadMessageLike, ToolCallMessagePart } from "@assistant-ui/core";
import { useLayoutEffect, useMemo, useRef } from "react";
import { type ConversationState, visibleMessages } from "../../../shared/conversation.ts";
import { Markdown } from "../../lib/markdown-view.tsx";

function toThreadMessages(state: ConversationState): readonly ThreadMessageLike[] {
	const rows: ThreadMessageLike[] = visibleMessages(state).map((message) =>
		message.tool === undefined
			? {
					id: message.id,
					role: message.role === "user" ? "user" : "assistant",
					content: [{ type: "text", text: message.text }],
					...(message.role === "user" ? {} : { status: { type: "complete", reason: "unknown" } }),
				}
			: {
					id: message.id,
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: message.id,
							toolName: message.tool.name,
							argsText: message.tool.summary,
							result: message.tool.output,
							isError: message.tool.status === "error",
						},
					],
					status: message.tool.status === "running" ? { type: "running" } : { type: "complete", reason: "unknown" },
				},
	);
	if (state.streaming !== undefined) {
		rows.push({
			id: state.streaming.id,
			role: "assistant",
			content: [{ type: "text", text: state.streaming.text }],
			status: { type: "running" },
		});
	}
	return rows;
}

function textOf(message: MessageState): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.filter((part) => part !== "")
		.join("\n");
}

function toolOf(message: MessageState): ToolCallMessagePart | undefined {
	return message.content.find((part): part is ToolCallMessagePart => part.type === "tool-call");
}

function ThreadRow({
	message,
	text,
	onOpenLink,
}: {
	readonly message: MessageState;
	readonly text: (key: string) => string;
	readonly onOpenLink: (url: string) => void;
}): React.JSX.Element {
	const tool = toolOf(message);
	if (tool !== undefined) {
		const status = tool.isError === true ? "error" : message.status?.type === "running" ? "running" : "ok";
		const output = typeof tool.result === "string" ? tool.result : undefined;
		return (
			<article className={`message message-tool tool-${status}`} data-role="tool">
				<span className="who">{tool.toolName}</span>
				<p className="text">
					<code>{tool.argsText ?? ""}</code> <span className="muted">({status})</span>
				</p>
				{output === undefined ? null : (
					<details className="tool-output" data-testid="tool-output">
						<summary>{text("conversation.output")}</summary>
						<pre>{output}</pre>
					</details>
				)}
			</article>
		);
	}

	const role = message.role === "user" ? "user" : "assistant";
	return (
		<article className={`message message-${role}`} data-role={role}>
			<span className="who">{text(`role.${role}`)}</span>
			<div className="text">
				<Markdown text={textOf(message)} onOpenLink={onOpenLink} />
			</div>
		</article>
	);
}

export function AssistantThread({
	state,
	text,
	onOpenLink,
	onSend,
	onStop,
	disabled,
	active,
}: {
	readonly state: ConversationState;
	readonly text: (key: string) => string;
	readonly onOpenLink: (url: string) => void;
	readonly onSend: (text: string) => void;
	readonly onStop: () => void;
	readonly disabled: boolean;
	readonly active: boolean;
}): React.JSX.Element {
	const messages = useMemo(() => toThreadMessages(state), [state]);
	const runtime = useExternalStoreRuntime({
		messages,
		convertMessage: (message) => message,
		isRunning: state.streaming !== undefined,
		isSendDisabled: disabled,
		onNew: async (message) => {
			const prompt = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("\n")
				.trim();
			if (prompt !== "") onSend(prompt);
		},
		onCancel: async () => onStop(),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<Transcript text={text} onOpenLink={onOpenLink} streaming={state.streaming !== undefined} active={active} />
		</AssistantRuntimeProvider>
	);
}

function Transcript({
	text,
	onOpenLink,
	streaming,
	active,
}: {
	readonly text: (key: string) => string;
	readonly onOpenLink: (url: string) => void;
	readonly streaming: boolean;
	readonly active: boolean;
}): React.JSX.Element {
	const messages = useThreadMessages();
	const viewport = useRef<HTMLDivElement | null>(null);
	const followEnd = useRef(true);

	useLayoutEffect(() => {
		const list = viewport.current;
		if (active && list !== null && followEnd.current) list.scrollTop = list.scrollHeight;
	}, [messages, active]);

	return (
		<div
			className="panel messages"
			ref={viewport}
			data-testid="messages"
			onScroll={(event) => {
				const list = event.currentTarget;
				followEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
			}}
		>
			{messages.map((message) => (
				<ThreadRow key={message.id} message={message} text={text} onOpenLink={onOpenLink} />
			))}
			{streaming ? (
				<span className="cursor" data-testid="streaming" aria-hidden="true">
					…
				</span>
			) : null}
		</div>
	);
}
