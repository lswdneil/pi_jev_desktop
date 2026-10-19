// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import type { KeyboardEvent } from "react";

export function Composer({
	draft,
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
	readonly onDraftChange: (value: string) => void;
	readonly onSend: () => void;
	readonly onStop: () => void;
	readonly running: boolean;
	readonly busy: boolean;
	readonly queued: number;
	readonly text: (key: string) => string;
	readonly large?: boolean;
}): React.JSX.Element {
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			onSend();
		}
	};

	return (
		<>
			<textarea
				value={draft}
				onChange={(event) => onDraftChange(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder={text("conversation.placeholder")}
				aria-label={text("conversation.message")}
				rows={large ? 5 : 4}
				className={large ? "composer-large" : undefined}
				disabled={!running || busy}
				data-testid="composer"
			/>
			<div className="row">
				<button type="button" data-testid="send" onClick={onSend} disabled={!running || busy || draft.trim() === ""}>
					{text("conversation.send")}
				</button>
				<button type="button" data-testid="stop" onClick={onStop} disabled={!running}>
					{text("conversation.stop")}
				</button>
				{queued === 0 ? null : (
					<span className="muted" data-testid="queue">
						{text("conversation.queued")} {queued}
					</span>
				)}
			</div>
		</>
	);
}
