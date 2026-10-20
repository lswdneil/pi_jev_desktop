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

import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PromptImage, SpecApi } from "../../../shared/api.ts";
import { type ConversationEvent, type ConversationState, visibleMessages } from "../../../shared/conversation.ts";
import type { ConversationStore } from "../../lib/conversation-store.ts";
import { presentationText } from "../../../shared/presentation.ts";
import { shellText } from "../../lib/shell-strings.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";

const AssistantThread = lazy(() => import("./AssistantThread.tsx").then((module) => ({ default: module.AssistantThread })));

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
	readonly api: SpecApi;
	readonly store: ConversationStore;
	readonly running: boolean;
	readonly active: boolean;
	readonly onError: (message: string) => void;
	readonly onOpenLink: (url: string) => void;
	readonly language: string;
}): React.JSX.Element {
	const state: ConversationState = useSyncExternalStore(store.subscribe, store.getSnapshot);
	const [busy, setBusy] = useState(false);
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

	const send = (value: string, images: readonly PromptImage[]): void => {
		const message = value.trim();
		if (message === "" || sending.current || !running) return;
		sending.current = true;
		setBusy(true);
		void api.harness
			.prompt(message, images)
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
			<Suspense fallback={<div className="panel messages" data-testid="messages" />}>
				<AssistantThread
					state={state}
					text={text}
					onOpenLink={onOpenLink}
					onSend={send}
					onStop={stop}
					onError={onError}
					disabled={!running || busy}
					canStop={running}
					active={active}
					empty={empty}
					queued={state.queue.steering + state.queue.followUp}
				/>
			</Suspense>

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
		</div>
	);
}
