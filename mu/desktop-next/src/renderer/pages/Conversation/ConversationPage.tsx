// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The conversation: what was said, what is being said, and what the agent is blocked on.
 *
 * Rendering is a function of the store's snapshot. Long conversations keep only the last window of messages on screen
 * (`VISIBLE_MESSAGES`) and the list is scrolled to the end as text arrives: two thousand messages are then a bounded
 * amount of DOM rather than a bounded amount of patience. Text is written as text, never as HTML — the model's words
 * are data.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MuApi } from "../../../shared/api.ts";
import { type ConversationEvent, type ConversationState, visibleMessages } from "../../../shared/conversation.ts";
import type { ConversationStore } from "../../lib/conversation-store.ts";
import { presentationText } from "../../../shared/presentation.ts";
import { Markdown } from "../../lib/markdown-view.tsx";
import { shellText } from "../../lib/shell-strings.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";

/** How many messages stay mounted. Older ones are history the panels summarise, not rows to scroll through. */
export function ConversationPage({
	api,
	store,
	running,
	active,
	onError,
	language,
}: {
	readonly api: MuApi;
	readonly store: ConversationStore;
	readonly running: boolean;
	readonly active: boolean;
	readonly onError: (message: string) => void;
	readonly language: string;
}): React.JSX.Element {
	const state: ConversationState = useSyncExternalStore(store.subscribe, store.getSnapshot);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const listRef = useRef<HTMLDivElement | null>(null);
	const followEnd = useRef(true);
	const sending = useRef(false);
	const text = (key: string): string => shellText(language, key);

	const visible = useMemo(() => visibleMessages(state), [state]);

	// The session outlives the window: what the harness already has is what this window opens with.
	useEffect(() => {
		if (!running) return;
		let alive = true;
		const epoch = store.getEpoch();
		void api.harness
			.history()
			.then((messages) => {
				if (alive) store.seed(messages, epoch);
			})
			.catch(() => {
				// No session yet (or the agent is still starting): the conversation begins empty, which is correct.
			});
		return () => {
			alive = false;
		};
	}, [api, store, running]);

	// Follow the end while the answer is being written; a person who scrolled up is not dragged back.
	useLayoutEffect(() => {
		const list = listRef.current;
		if (active && list !== null && followEnd.current) list.scrollTop = list.scrollHeight;
	}, [state.revision, active]);

	const send = (): void => {
		const message = draft.trim();
		if (message === "" || sending.current || !running) return;
		sending.current = true;
		setBusy(true);
		void api.harness
			.prompt(message)
			.then(() => setDraft(""))
			.catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
			.finally(() => {
				sending.current = false;
				setBusy(false);
			});
	};

	const stop = (): void => {
		void api.harness.abort().catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
	};

	return (
		<div className="conversation" data-testid="conversation" lang={language}>
			<div
				className="panel messages"
				ref={listRef}
				data-testid="messages"
				onScroll={(event) => {
					const list = event.currentTarget;
					followEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
				}}
			>
				{visible.length === 0 ? <p className="muted">{text("conversation.empty")}</p> : null}
				{visible.map((message) =>
					message.tool === undefined ? (
						<article key={message.id} className={`message message-${message.role}`} data-role={message.role}>
							<span className="who">{message.role}</span>
							<div className="text">
								<Markdown text={message.text} />
							</div>
						</article>
					) : (
						<article key={message.id} className={`message message-tool tool-${message.tool.status}`} data-role="tool">
							<span className="who">{message.tool.name}</span>
							<p className="text">
								<code>{message.tool.summary}</code> <span className="muted">({message.tool.status})</span>
							</p>
						</article>
					),
				)}
				{state.streaming === undefined ? null : (
					<span className="cursor" data-testid="streaming" aria-hidden="true">
						▍
					</span>
				)}
			</div>

			{state.approval === undefined ? null : (
				<ApprovalCard
					approval={state.approval}
					api={api}
					onError={onError}
					onAnswered={(id) => store.push({ type: "extension_ui_response", id } as unknown as ConversationEvent)}
				/>
			)}

			{state.notices.length === 0 ? null : (
				<section className="panel notices" data-testid="notices">
					{state.notices.map((notice) => (
						<p key={notice.id} className="muted" data-code={notice.event.code}>
							{presentationText(notice.event, language)}
						</p>
					))}
				</section>
			)}

			<section className="panel">
				<textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							send();
						}
					}}
					placeholder={text("conversation.placeholder")}
					aria-label={text("conversation.message")}
					rows={4}
					disabled={!running || busy}
					data-testid="composer"
				/>
				<div className="row">
					<button type="button" data-testid="send" onClick={send} disabled={!running || busy || draft.trim() === ""}>
						{text("conversation.send")}
					</button>
					<button type="button" data-testid="stop" onClick={stop} disabled={!running}>
						{text("conversation.stop")}
					</button>
					{state.queue.steering + state.queue.followUp === 0 ? null : (
						<span className="muted" data-testid="queue">
							{text("conversation.queued")} {state.queue.steering + state.queue.followUp}
						</span>
					)}
				</div>
			</section>
		</div>
	);
}
