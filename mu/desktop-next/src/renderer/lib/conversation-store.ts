// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The conversation's state, outside React.
 *
 * A delta arrives per token; putting each one into React state would re-render the whole tree hundreds of times a
 * second. The store folds events into the pure reducer and notifies subscribers once per animation frame, and the
 * component reads the snapshot with `useSyncExternalStore`. The reducer is the tested part (`shared/conversation.ts`);
 * this file is only the plumbing that keeps React out of the hot path.
 */

import {
	type ConversationEvent,
	type ConversationState,
	type HistoryMessage,
	initialConversation,
	reduceAll,
	seedConversation,
} from "../../shared/conversation.ts";

type Listener = () => void;

export class ConversationStore {
	private state: ConversationState = initialConversation();
	private readonly listeners = new Set<Listener>();
	private pending: ConversationEvent[] = [];
	private frame: number | undefined;
	private epoch = 0;

	readonly subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): ConversationState => this.state;
	readonly getEpoch = (): number => this.epoch;

	/** Buffer an event and schedule one fold per frame. */
	push(event: ConversationEvent): void {
		this.pending.push(event);
		if (this.frame !== undefined) return;
		this.frame = requestAnimationFrame(() => this.flush());
	}

	/** Fold everything buffered now. Called by the frame callback, and by tests. */
	flush(): void {
		if (this.frame !== undefined) {
			cancelAnimationFrame(this.frame);
			this.frame = undefined;
		}
		if (this.pending.length === 0) return;
		const events = this.pending;
		this.pending = [];
		this.state = reduceAll(this.state, events);
		for (const listener of this.listeners) listener();
	}

	/** Start a new conversation: the old messages are somebody else's session. */
	reset(): void {
		this.epoch++;
		if (this.frame !== undefined) cancelAnimationFrame(this.frame);
		this.frame = undefined;
		this.pending = [];
		this.state = initialConversation();
		for (const listener of this.listeners) listener();
	}

	/**
	 * Seed the session's existing messages, once. Opening a window into a running session must show the conversation
	 * that session already has; a second load is a no-op, because the seeded ids are stable.
	 */
	seed(messages: readonly HistoryMessage[], epoch: number = this.epoch): void {
		if (epoch !== this.epoch) return;
		const next = seedConversation(this.state, messages);
		if (next === this.state) return;
		this.state = next;
		for (const listener of this.listeners) listener();
	}
}
