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
import logo from "../../assets/logo.png";
import { MAX_PROMPT_IMAGES, type MuApi, PROMPT_IMAGE_TYPES } from "../../../shared/api.ts";
import { type ConversationEvent, type ConversationState, visibleMessages } from "../../../shared/conversation.ts";
import type { ConversationStore } from "../../lib/conversation-store.ts";
import { presentationText } from "../../../shared/presentation.ts";
import { Markdown } from "../../lib/markdown-view.tsx";
import { shellText } from "../../lib/shell-strings.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { type AttachedImage, Composer } from "./Composer.tsx";

/**
 * What the log says a person answered. The three words the card's buttons produce are codes so a language switch
 * re-renders them; anything else is text someone typed, shown as they typed it.
 */
function answerText(answer: string, text: (key: string) => string): string {
	return answer === "allowed" || answer === "denied" || answer === "cancelled"
		? text(`decision.${answer}`)
		: `"${answer}"`;
}

export function ConversationPage({
	api,
	store,
	running,
	active,
	onError,
	onOpenLink,
	language,
}: {
	readonly api: MuApi;
	readonly store: ConversationStore;
	readonly running: boolean;
	readonly active: boolean;
	readonly onError: (message: string) => void;
	readonly onOpenLink: (url: string) => void;
	readonly language: string;
}): React.JSX.Element {
	const state: ConversationState = useSyncExternalStore(store.subscribe, store.getSnapshot);
	const [draft, setDraft] = useState("");
	const [images, setImages] = useState<readonly AttachedImage[]>([]);
	const [busy, setBusy] = useState(false);
	const listRef = useRef<HTMLDivElement | null>(null);
	const followEnd = useRef(true);
	const sending = useRef(false);
	const text = (key: string): string => shellText(language, key);

	const visible = useMemo(() => visibleMessages(state), [state]);
	const empty =
		visible.length === 0 && state.streaming === undefined && state.approval === undefined && state.notices.length === 0;

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
			.prompt(
				message,
				images.map((image) => ({ mimeType: image.mimeType, data: image.data })),
			)
			.then(() => {
				setDraft("");
				setImages([]);
			})
			.catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
			.finally(() => {
				sending.current = false;
				setBusy(false);
			});
	};

	const stop = (): void => {
		void api.harness.abort().catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
	};

	/**
	 * Read images into the draft. The bridge checks all of this again — this is the part that can say why on screen
	 * before a round trip, not the part that makes it safe.
	 */
	const addImages = (files: readonly File[]): void => {
		const room = MAX_PROMPT_IMAGES - images.length;
		if (room <= 0) {
			onError(text("conversation.imageLimit"));
			return;
		}
		if (files.length > room) onError(text("conversation.imageLimit"));
		for (const file of files.slice(0, room)) {
			if (!(PROMPT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
				onError(text("conversation.imageType"));
				continue;
			}
			if (file.size > 5 * 1024 * 1024) {
				onError(text("conversation.imageTooLarge"));
				continue;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const result = typeof reader.result === "string" ? reader.result : "";
				const data = result.slice(result.indexOf(",") + 1);
				if (data === "") return;
				const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
				setImages((current) =>
					current.length >= MAX_PROMPT_IMAGES ? current : [...current, { id, name: file.name, mimeType: file.type, data }],
				);
			};
			reader.readAsDataURL(file);
		}
	};

	return (
		<div className="conversation" data-testid="conversation" lang={language}>
			{empty ? (
				<section className="workspace-home">
					<img className="hero-mark" src={logo} alt="" />
					<p className="hero-eyebrow">{text("conversation.eyebrow")}</p>
					<h1>{text("conversation.hero")}</h1>
					<p className="hero-copy">{text("conversation.heroBody")}</p>
					<div className="composer-hero">
						<Composer
							draft={draft}
							images={images}
							onAddImages={addImages}
							onRemoveImage={(id) => setImages((current) => current.filter((image) => image.id !== id))}
							onDraftChange={setDraft}
							onSend={send}
							onStop={stop}
							running={running}
							busy={busy}
							queued={state.queue.steering + state.queue.followUp}
							text={text}
							large
						/>
					</div>
					<div className="hero-suggestions">
						{["conversation.suggest1", "conversation.suggest2", "conversation.suggest3"].map((key) => (
							<button key={key} type="button" className="hero-suggestion" onClick={() => setDraft(text(key))}>
								{text(key)}
							</button>
						))}
					</div>
				</section>
			) : null}

			{empty ? null : (
				<>
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
							<span className="who">{text(`role.${message.role}`)}</span>
							<div className="text">
								<Markdown text={message.text} onOpenLink={onOpenLink} />
							</div>
						</article>
					) : (
						<article key={message.id} className={`message message-tool tool-${message.tool.status}`} data-role="tool">
							<span className="who">{message.tool.name}</span>
							<p className="text">
								<code>{message.tool.summary}</code> <span className="muted">({message.tool.status})</span>
							</p>
							{message.tool.output === undefined ? null : (
								<details className="tool-output" data-testid="tool-output">
									<summary>{text("conversation.output")}</summary>
									<pre>{message.tool.output}</pre>
								</details>
							)}
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
					text={text}
					onAnswered={(approval, answer) => {
						store.answer(approval, answer);
						store.push({ type: "extension_ui_response", id: approval.id } as unknown as ConversationEvent);
					}}
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

			{state.decisions.length === 0 ? null : (
				<details className="panel decisions-log" data-testid="decisions-log">
					<summary>
						{text("decision.log")} ({state.decisions.length})
					</summary>
					<ul>
						{state.decisions.map((decision, index) => (
							<li key={`${decision.id}-${index}`} data-decision={decision.answer}>
								<span className="decision-answer">{answerText(decision.answer, text)}</span>{" "}
								<span>{decision.title}</span>
								{decision.message === undefined ? null : <div className="muted">{decision.message}</div>}
							</li>
						))}
					</ul>
				</details>
			)}

			<section className="panel">
				<Composer
					draft={draft}
					images={images}
					onAddImages={addImages}
					onRemoveImage={(id) => setImages((current) => current.filter((image) => image.id !== id))}
					onDraftChange={setDraft}
					onSend={send}
					onStop={stop}
					running={running}
					busy={busy}
					queued={state.queue.steering + state.queue.followUp}
					text={text}
				/>
			</section>
				</>
			)}
		</div>
	);
}
