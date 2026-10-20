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
} from "@assistant-ui/core/react";
import {
	SimpleImageAttachmentAdapter,
	type AppendMessage,
	type AttachmentAdapter,
	type CompleteAttachment,
	type PendingAttachment,
	type ThreadMessageLike,
} from "@assistant-ui/core";
import {
	MessagePrimitive,
	ThreadPrimitive,
	type MessageState,
	type TextMessagePartProps,
	type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { FilePenLine, Terminal, Wrench } from "lucide-react";
import { useMemo } from "react";
import { MAX_PROMPT_IMAGES, PROMPT_IMAGE_TYPES, type PromptImage } from "../../../shared/api.ts";
import { type ConversationState, visibleMessages } from "../../../shared/conversation.ts";
import { toolResultText } from "../../../shared/conversation.ts";
import { Markdown } from "../../lib/markdown-view.tsx";
import logo from "../../assets/logo.png";
import { AssistantComposer } from "./AssistantComposer.tsx";

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

function promptImages(message: AppendMessage): readonly PromptImage[] {
	const images: PromptImage[] = [];
	for (const attachment of message.attachments ?? []) {
		for (const part of attachment.content) {
			if (part.type !== "image") continue;
			const comma = part.image.indexOf(",");
			if (comma < 0) continue;
			const header = part.image.slice(0, comma);
			const mimeType = header.slice(header.indexOf(":") + 1).split(";")[0] || attachment.contentType || "image/png";
			images.push({ mimeType, data: part.image.slice(comma + 1) });
		}
	}
	return images;
}

class SpecImageAttachmentAdapter implements AttachmentAdapter {
	readonly accept = PROMPT_IMAGE_TYPES.join(",");
	private readonly inner = new SimpleImageAttachmentAdapter();
	private readonly onError: (message: string) => void;
	private readonly text: (key: string) => string;

	constructor(onError: (message: string) => void, text: (key: string) => string) {
		this.onError = onError;
		this.text = text;
	}

	add({ file }: { file: File }): Promise<PendingAttachment> {
		if (!(PROMPT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
			this.onError(this.text("conversation.imageType"));
			return Promise.reject(new Error("unsupported image type"));
		}
		if (file.size > 5 * 1024 * 1024) {
			this.onError(this.text("conversation.imageTooLarge"));
			return Promise.reject(new Error("image is too large"));
		}
		return this.inner.add({ file });
	}

	send(attachment: PendingAttachment, options?: { signal?: AbortSignal }): Promise<CompleteAttachment> {
		return this.inner.send(attachment, options);
	}

	remove(): Promise<void> {
		return this.inner.remove();
	}
}

function ToolFallback({
	toolName,
	argsText,
	result,
	status,
	isError,
	text,
}: ToolCallMessagePartProps & { readonly text: (key: string) => string }): React.JSX.Element {
	const state = isError === true ? "error" : status.type === "running" ? "running" : "ok";
	const output = toolResultText(result);
	const label =
		state === "error"
			? text("conversation.toolFailed")
			: state === "running"
				? text("conversation.toolRunning")
				: text("conversation.toolDone");
	const ToolIcon = /write|edit|patch/i.test(toolName)
		? FilePenLine
		: /bash|shell|exec/i.test(toolName)
			? Terminal
			: Wrench;
	return (
		<article className={`message message-tool tool-${state}`} data-role="tool">
			<div className="tool-head">
				<span className="tool-icon" aria-hidden="true">
					<ToolIcon />
				</span>
				<span className="tool-name">{toolName}</span>
				<code className="tool-args" title={argsText ?? ""}>
					{argsText ?? ""}
				</code>
				<span className={`tool-status tool-status-${state}`}>{label}</span>
			</div>
			{output === undefined ? null : (
				<details className="tool-output" data-testid="tool-output">
					<summary>{text("conversation.output")}</summary>
					<pre>{output}</pre>
				</details>
			)}
		</article>
	);
}

function TranscriptMessage({
	message,
	text,
	onOpenLink,
	onCopy,
}: {
	readonly message: MessageState;
	readonly text: (key: string) => string;
	readonly onOpenLink: (url: string) => void;
	readonly onCopy: (value: string) => Promise<void>;
}): React.JSX.Element {
	const hasTool = message.content.some((part) => part.type === "tool-call");
	const role = message.role === "user" ? "user" : "assistant";
	const components = {
		Text: ({ text: value }: TextMessagePartProps) => (
			<Markdown text={value} onOpenLink={onOpenLink} labels={text} onCopy={onCopy} />
		),
		tools: { Override: (props: ToolCallMessagePartProps) => <ToolFallback {...props} text={text} /> },
	};
	return (
		<MessagePrimitive.Root
			className={hasTool ? "contents" : `message message-${role}`}
			data-role={hasTool ? "tool" : role}
		>
			{hasTool ? (
				<MessagePrimitive.Parts components={components} />
			) : (
				<>
					<span className="who">{text(`role.${role}`)}</span>
					<div className="text">
						<MessagePrimitive.Parts components={components} />
					</div>
				</>
			)}
		</MessagePrimitive.Root>
	);
}

export function AssistantThread({
	state,
	text,
	onOpenLink,
	onCopy,
	onSend,
	onStop,
	onError,
	disabled,
	canStop,
	active,
	empty,
	queued,
}: {
	readonly state: ConversationState;
	readonly text: (key: string) => string;
	readonly onOpenLink: (url: string) => void;
	readonly onCopy: (value: string) => Promise<void>;
	readonly onSend: (text: string, images: readonly PromptImage[]) => void;
	readonly onStop: () => void;
	readonly onError: (message: string) => void;
	readonly disabled: boolean;
	readonly canStop: boolean;
	readonly active: boolean;
	readonly empty: boolean;
	readonly queued: number;
}): React.JSX.Element {
	const messages = useMemo(() => toThreadMessages(state), [state]);
	const attachments = useMemo(() => new SpecImageAttachmentAdapter(onError, text), [onError, text]);
	const runtime = useExternalStoreRuntime({
		messages,
		convertMessage: (message) => message,
		isRunning: state.running || state.streaming !== undefined,
		isSendDisabled: disabled,
		adapters: { attachments },
		onNew: async (message) => {
			const prompt = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("\n")
				.trim();
			if (prompt === "") return;
			const images = promptImages(message);
			if (images.length > MAX_PROMPT_IMAGES) {
				onError(text("conversation.imageLimit"));
				return;
			}
			onSend(prompt, images);
		},
		onCancel: async () => onStop(),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			{empty ? (
				<section className="workspace-home">
					<img className="hero-mark" src={logo} alt="" />
					<p className="hero-eyebrow">{text("conversation.eyebrow")}</p>
					<h1>{text("conversation.hero")}</h1>
					<p className="hero-copy">{text("conversation.heroBody")}</p>
					<div className="composer-hero">
						<ThreadPrimitive.ViewportProvider>
							<AssistantComposer
								text={text}
								disabled={disabled}
							canStop={canStop}
							onStop={onStop}
							onError={onError}
								queued={queued}
								large
								suggestions={["conversation.suggest1", "conversation.suggest2", "conversation.suggest3"]}
							/>
						</ThreadPrimitive.ViewportProvider>
					</div>
				</section>
			) : (
				<>
					<Transcript
						text={text}
						onOpenLink={onOpenLink}
						onCopy={onCopy}
						streaming={state.streaming !== undefined}
						active={active}
					/>
					<section className="panel">
						<ThreadPrimitive.ViewportProvider>
						<AssistantComposer
							text={text}
							disabled={disabled}
							canStop={canStop}
							onStop={onStop}
							onError={onError}
							queued={queued}
						/>
						</ThreadPrimitive.ViewportProvider>
					</section>
				</>
			)}
		</AssistantRuntimeProvider>
	);
}

function Transcript({
	text,
	onOpenLink,
	onCopy,
	streaming,
	active,
}: {
	readonly text: (key: string) => string;
	readonly onOpenLink: (url: string) => void;
	readonly onCopy: (value: string) => Promise<void>;
	readonly streaming: boolean;
	readonly active: boolean;
}): React.JSX.Element {
	return (
		<ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
			<ThreadPrimitive.Viewport className="panel messages" data-testid="messages" autoScroll={active}>
				<ThreadPrimitive.Messages>
					{({ message }) => (
						<TranscriptMessage
							key={message.id}
							message={message}
							text={text}
							onOpenLink={onOpenLink}
							onCopy={onCopy}
						/>
					)}
				</ThreadPrimitive.Messages>
				{streaming ? (
					<span className="cursor" data-testid="streaming" aria-hidden="true">
						…
					</span>
				) : null}
			</ThreadPrimitive.Viewport>
		</ThreadPrimitive.Root>
	);
}
