// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * The message composer on assistant-ui primitives.
 *
 * Draft text, attachments, send/cancel availability and the Ctrl+Enter shortcut live in the assistant-ui runtime.
 * The product supplies the Freebuff styling and the labels; the protocol still receives the prompt through
 * `AssistantThread`'s external-store adapter.
 */

import { AttachmentPrimitive, ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ArrowUp, ImagePlus, Paperclip, Square, X } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { MAX_PROMPT_IMAGES, PROMPT_IMAGE_TYPES } from "../../../shared/api.ts";
import { Button } from "../../ui/button.tsx";

function ImageAttachment(): React.JSX.Element {
	return (
		<div className="attachment relative" data-testid="attachment">
			<AttachmentPrimitive.unstable_Thumb className="size-14 rounded-[8px] border border-border bg-[var(--panel-2)] object-cover" />
			<AttachmentPrimitive.Remove asChild>
				<Button type="button" variant="ghost" size="icon-sm" className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--panel)]">
					<X />
				</Button>
			</AttachmentPrimitive.Remove>
		</div>
	);
}

export function AssistantComposer({
	text,
	large = false,
	disabled,
	canStop,
	onStop,
	onError,
	queued,
	suggestions,
}: {
	readonly text: (key: string) => string;
	readonly large?: boolean;
	readonly disabled: boolean;
	readonly canStop: boolean;
	readonly onStop: () => void;
	readonly onError: (message: string) => void;
	readonly queued: number;
	readonly suggestions?: readonly string[];
}): React.JSX.Element {
	const aui = useAui();
	const hasAttachments = useAuiState((state) => state.composer.attachments.length > 0);
	const fileInput = useRef<HTMLInputElement | null>(null);
	const [dragging, setDragging] = useState(false);
	const dragDepth = useRef(0);

	const hasFiles = (event: DragEvent<HTMLElement>): boolean =>
		Array.from(event.dataTransfer.types).includes("Files");
	const onDragEnter = (event: DragEvent<HTMLElement>): void => {
		if (!hasFiles(event)) return;
		event.preventDefault();
		dragDepth.current += 1;
		setDragging(true);
	};
	const onDragOver = (event: DragEvent<HTMLElement>): void => {
		if (!hasFiles(event)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	};
	const onDragLeave = (event: DragEvent<HTMLElement>): void => {
		if (!hasFiles(event)) return;
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) setDragging(false);
	};
	const onDrop = (): void => {
		dragDepth.current = 0;
		setDragging(false);
	};

	const addFiles = (files: FileList | null): void => {
		if (files === null) return;
		for (const file of [...files]) {
			if (!(PROMPT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
				onError(text("conversation.imageType"));
				continue;
			}
			if (file.size > 5 * 1024 * 1024) {
				onError(text("conversation.imageTooLarge"));
				continue;
			}
			if (aui.composer.getState().attachments.length >= MAX_PROMPT_IMAGES) {
				onError(text("conversation.imageLimit"));
				break;
			}
			void aui.composer.addAttachment(file).catch((error: unknown) => {
				onError(error instanceof Error ? error.message : String(error));
			});
		}
	};

	return (
		<>
			<ComposerPrimitive.Root
				className="composer-drop flex flex-col gap-2"
				onDragEnter={onDragEnter}
				onDragOver={onDragOver}
				onDragLeave={onDragLeave}
				onDrop={onDrop}
			>
				{dragging ? (
					<div className="composer-dropzone" data-testid="composer-dropzone" aria-hidden="true">
						<ImagePlus />
						{text("conversation.dropImages")}
					</div>
				) : null}
				<ComposerPrimitive.AttachmentDropzone className="flex flex-col gap-2">
					{hasAttachments ? (
						<div className="flex flex-wrap gap-2" data-testid="attachments">
							<ComposerPrimitive.Attachments components={{ Image: ImageAttachment, Attachment: ImageAttachment }} />
						</div>
					) : null}
					<ComposerPrimitive.Input
						placeholder={text("conversation.placeholder")}
						aria-label={text("conversation.message")}
						submitMode="ctrlEnter"
						disabled={disabled}
						minRows={large ? 5 : 4}
						className={large ? "min-h-[112px] resize-none border-0 bg-transparent px-1 py-1" : "min-h-[88px] resize-none"}
						data-testid="composer"
					/>
				</ComposerPrimitive.AttachmentDropzone>
				<div className="flex flex-wrap items-center gap-2">
					<ComposerPrimitive.Send asChild>
						<Button type="button" data-testid="send">
							<ArrowUp />
							{text("conversation.send")}
						</Button>
					</ComposerPrimitive.Send>
					<Button type="button" variant="outline" data-testid="stop" disabled={!canStop} onClick={onStop}>
						<Square />
						{text("conversation.stop")}
					</Button>
					<Button type="button" variant="ghost" data-testid="attach" title={text("conversation.attach")} onClick={() => fileInput.current?.click()}>
						<Paperclip />
						{text("conversation.attach")}
					</Button>
					<input
						ref={fileInput}
						type="file"
						accept={PROMPT_IMAGE_TYPES.join(",")}
						multiple
						hidden
						data-testid="attach-input"
						onChange={(event) => {
							addFiles(event.target.files);
							event.target.value = "";
						}}
					/>
					{queued === 0 ? null : (
						<span className="composer-queue" data-testid="queue">
							{text("conversation.queued")} {queued}
						</span>
					)}
					<span className="composer-hint" data-testid="composer-hint">
						{text("conversation.sendHint")}
					</span>
				</div>
			</ComposerPrimitive.Root>

			{suggestions === undefined || suggestions.length === 0 ? null : (
				<div className="hero-suggestions">
					{suggestions.map((key) => (
						<button key={key} type="button" className="hero-suggestion" onClick={() => aui.composer.setText(text(key))}>
							{text(key)}
						</button>
					))}
				</div>
			)}
		</>
	);
}
