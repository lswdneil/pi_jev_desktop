// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { Button } from "../../ui/button.tsx";
import { Textarea } from "../../ui/textarea.tsx";

/** An image the composer holds before it is sent. `data` is base64 without the `data:` prefix. */
export interface AttachedImage {
	readonly id: string;
	readonly name: string;
	readonly mimeType: string;
	readonly data: string;
}

export function Composer({
	draft,
	images,
	onAddImages,
	onRemoveImage,
	onDraftChange,
	onSend,
	onStop,
	running,
	busy,
	queued,
	text,
	large = false,
}: {
	readonly draft: string;
	readonly images: readonly AttachedImage[];
	readonly onAddImages: (files: readonly File[]) => void;
	readonly onRemoveImage: (id: string) => void;
	readonly onDraftChange: (value: string) => void;
	readonly onSend: () => void;
	readonly onStop: () => void;
	readonly running: boolean;
	readonly busy: boolean;
	readonly queued: number;
	readonly text: (key: string) => string;
	readonly large?: boolean;
}): React.JSX.Element {
	const fileInput = useRef<HTMLInputElement | null>(null);
	const [dragging, setDragging] = useState(false);

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			onSend();
		}
	};

	/** A paste of an image arrives as a file on the clipboard; text pastes into the textarea as it always did. */
	const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
		const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
		if (files.length === 0) return;
		event.preventDefault();
		onAddImages(files);
	};

	return (
		<>
			<div
				className={dragging ? "composer-drop dragging" : "composer-drop"}
				onDragOver={(event) => {
					if (!event.dataTransfer.types.includes("Files")) return;
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					if (event.dataTransfer.files.length === 0) return;
					event.preventDefault();
					setDragging(false);
					onAddImages([...event.dataTransfer.files]);
				}}
			>
				<Textarea
					value={draft}
					onChange={(event) => onDraftChange(event.target.value)}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					placeholder={text("conversation.placeholder")}
					aria-label={text("conversation.message")}
					rows={large ? 5 : 4}
					className={large ? "min-h-[132px]" : "min-h-[96px]"}
					disabled={!running || busy}
					data-testid="composer"
				/>
				{dragging ? <p className="composer-hint">{text("conversation.dropImage")}</p> : null}
			</div>
			{images.length === 0 ? null : (
				<ul className="attachments" data-testid="attachments">
					{images.map((image) => (
						<li key={image.id} className="attachment" title={image.name}>
							<img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--panel)]"
								aria-label={`${text("conversation.removeImage")}: ${image.name}`}
								onClick={() => onRemoveImage(image.id)}
							>
								<X />
							</Button>
						</li>
					))}
				</ul>
			)}
			<div className="flex flex-wrap items-center gap-2 pt-1">
				<Button type="button" data-testid="send" onClick={onSend} disabled={!running || busy || draft.trim() === ""}>
					<ArrowUp />
					{text("conversation.send")}
				</Button>
				<Button type="button" data-testid="stop" variant="outline" onClick={onStop} disabled={!running}>
					<Square />
					{text("conversation.stop")}
				</Button>
				<Button
					type="button"
					variant="ghost"
					data-testid="attach"
					onClick={() => fileInput.current?.click()}
					disabled={!running || busy}
					title={text("conversation.attach")}
				>
					<Paperclip />
					{text("conversation.attach")}
				</Button>
				<input
					ref={fileInput}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					multiple
					hidden
					data-testid="attach-input"
					onChange={(event) => {
						const files = [...(event.target.files ?? [])];
						if (files.length > 0) onAddImages(files);
						event.target.value = "";
					}}
				/>
				{queued === 0 ? null : (
					<span className="muted" data-testid="queue">
						{text("conversation.queued")} {queued}
					</span>
				)}
			</div>
		</>
	);
}
